import { matchSettlement } from "./matcher";
import { ambiguousDraft, evaluateMatch, missingDraft, orphanDraft } from "./discrepancies";
import { resolveStatus } from "./status";
import type {
  DiscrepancyDraft,
  FeeRule,
  MatchMethod,
  NormalizedSettlement,
  ReconciliationStatus,
  TxnCandidate,
} from "./types";

export type SettlementForPlan = NormalizedSettlement & {
  id: string;
  matched_transaction_id: string | null;
  match_method: MatchMethod | string | null;
  match_confidence: number | null;
};

export interface ExistingDiscrepancy {
  id: string;
  fingerprint: string | null;
  discrepancy_type: string;
  severity: string;
  currency: string | null;
  expected_amount_minor: number | null;
  actual_amount_minor: number | null;
  variance_amount_minor: number | null;
  reason: string | null;
  resolution_status: string;
}

export interface FingerprintedDraft extends DiscrepancyDraft {
  fingerprint: string;
}

export interface EventRow {
  transaction_id: string | null;
  settlement_record_id: string | null;
  event_type: string;
  match_method: string | null;
  details: unknown;
}

export interface MatchUpdate {
  id: string;
  matched_transaction_id: string | null;
  match_method: string | null;
  match_confidence: number | null;
}

export interface ReconciliationSummary {
  matched: number;
  ambiguous: number;
  orphaned: number;
  amountVariances: number;
  feeVariances: number;
  missing: number;
  statusCounts: Record<ReconciliationStatus, number>;
  ranAt: string;
}

export interface ReconciliationPlan {
  matchUpdates: MatchUpdate[];
  statusUpdates: Array<{ id: string; status: ReconciliationStatus }>;
  discrepancyInserts: FingerprintedDraft[];
  discrepancyUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
  discrepancyDeleteIds: string[];
  events: EventRow[];
  summary: ReconciliationSummary;
}

export function fingerprintFor(draft: DiscrepancyDraft): string {
  return `${draft.discrepancy_type}:${draft.transaction_id ?? "-"}:${draft.settlement_record_id ?? "-"}`;
}

function materiallyDiffers(existing: ExistingDiscrepancy, draft: FingerprintedDraft): boolean {
  return (
    existing.discrepancy_type !== draft.discrepancy_type ||
    existing.severity !== draft.severity ||
    (existing.currency ?? null) !== (draft.currency ?? null) ||
    (existing.expected_amount_minor ?? null) !== (draft.expected_amount_minor ?? null) ||
    (existing.actual_amount_minor ?? null) !== (draft.actual_amount_minor ?? null) ||
    (existing.variance_amount_minor ?? null) !== (draft.variance_amount_minor ?? null) ||
    (existing.reason ?? null) !== (draft.reason ?? null)
  );
}

/**
 * Pure reconciliation planner.
 *
 * Computes the desired end state (matches, statuses, findings) from the
 * current data, then diffs it against what is already stored. Only genuine
 * changes produce writes or audit events, so re-running with unchanged data
 * is a no-op.
 */
export function planReconciliation(input: {
  transactions: TxnCandidate[];
  settlements: SettlementForPlan[];
  feeRules: FeeRule[];
  existingDiscrepancies: ExistingDiscrepancy[];
  now: Date;
  rematchAll?: boolean;
}): ReconciliationPlan {
  const { transactions, settlements, feeRules, existingDiscrepancies, now } = input;
  const rematchAll = input.rematchAll ?? false;

  const txnById = new Map(transactions.map((t) => [t.id, t]));
  const drafts: FingerprintedDraft[] = [];
  const events: EventRow[] = [];
  const matchUpdates: MatchUpdate[] = [];
  const claimed = new Set<string>();
  const matchedTxnIds = new Set<string>();
  const varianceTxnIds = new Set<string>();

  let matched = 0;
  let ambiguous = 0;
  let orphaned = 0;
  let amountVariances = 0;
  let feeVariances = 0;

  const pushDraft = (d: DiscrepancyDraft) => drafts.push({ ...d, fingerprint: fingerprintFor(d) });

  // Pass 1 — honour existing matches so they never re-enter the matcher.
  const preserved = new Map<string, TxnCandidate>();
  if (!rematchAll) {
    for (const s of settlements) {
      const txn = s.matched_transaction_id ? txnById.get(s.matched_transaction_id) : undefined;
      if (txn) {
        preserved.set(s.id, txn);
        claimed.add(txn.id);
      }
    }
  }

  // Pass 2 — settle every settlement record.
  for (const settlement of settlements) {
    const kept = preserved.get(settlement.id);
    if (kept) {
      matched++;
      matchedTxnIds.add(kept.id);
      const variances = evaluateMatch({ transaction: kept, settlement, feeRules });
      for (const v of variances) {
        if (v.discrepancy_type === "AMOUNT_VARIANCE") amountVariances++;
        if (v.discrepancy_type === "FEE_VARIANCE") feeVariances++;
        varianceTxnIds.add(kept.id);
        pushDraft(v);
      }
      continue;
    }

    const outcome = matchSettlement(settlement, transactions, { excludeTransactionIds: claimed });

    if (outcome.kind === "MATCHED") {
      matched++;
      claimed.add(outcome.transaction.id);
      matchedTxnIds.add(outcome.transaction.id);
      if (
        settlement.matched_transaction_id !== outcome.transaction.id ||
        settlement.match_method !== outcome.method ||
        settlement.match_confidence !== outcome.confidence
      ) {
        matchUpdates.push({
          id: settlement.id,
          matched_transaction_id: outcome.transaction.id,
          match_method: outcome.method,
          match_confidence: outcome.confidence,
        });
        events.push({
          transaction_id: outcome.transaction.id,
          settlement_record_id: settlement.id,
          event_type: "MATCHED",
          match_method: outcome.method,
          details: { confidence: outcome.confidence },
        });
      }

      const variances = evaluateMatch({ transaction: outcome.transaction, settlement, feeRules });
      for (const v of variances) {
        if (v.discrepancy_type === "AMOUNT_VARIANCE") amountVariances++;
        if (v.discrepancy_type === "FEE_VARIANCE") feeVariances++;
        varianceTxnIds.add(outcome.transaction.id);
        pushDraft(v);
      }
      continue;
    }

    const wasMatched = settlement.matched_transaction_id !== null;
    if (wasMatched || settlement.match_method !== null || settlement.match_confidence !== null) {
      matchUpdates.push({
        id: settlement.id,
        matched_transaction_id: null,
        match_method: null,
        match_confidence: null,
      });
    }

    if (outcome.kind === "AMBIGUOUS") {
      ambiguous++;
      pushDraft(ambiguousDraft(settlement, outcome.candidates, outcome.tier));
      if (wasMatched || settlement.match_method !== null) {
        events.push({
          transaction_id: null,
          settlement_record_id: settlement.id,
          event_type: "AMBIGUOUS",
          match_method: outcome.tier,
          details: { candidates: outcome.candidates.map((c) => c.transaction_id) },
        });
      }
    } else {
      orphaned++;
      pushDraft(orphanDraft(settlement));
      if (wasMatched || settlement.match_method !== null) {
        events.push({
          transaction_id: null,
          settlement_record_id: settlement.id,
          event_type: "ORPHANED",
          match_method: null,
          details: { processor: settlement.processor },
        });
      }
    }
  }

  // Pass 3 — transaction status sweep.
  const statusCounts: Record<ReconciliationStatus, number> = {
    NOT_DUE: 0,
    PENDING: 0,
    SETTLED: 0,
    OVERDUE: 0,
    VARIANCE: 0,
  };
  let missing = 0;
  const statusUpdates: Array<{ id: string; status: ReconciliationStatus }> = [];

  for (const transaction of transactions) {
    const { status, raiseMissing } = resolveStatus({
      transaction,
      hasSettlement: matchedTxnIds.has(transaction.id),
      hasVariance: varianceTxnIds.has(transaction.id),
      now,
    });
    statusCounts[status]++;
    if (status !== transaction.reconciliation_status) {
      statusUpdates.push({ id: transaction.id, status });
      events.push({
        transaction_id: transaction.id,
        settlement_record_id: null,
        event_type: "STATUS_CHANGED",
        match_method: null,
        details: { from: transaction.reconciliation_status, to: status },
      });
    }
    if (raiseMissing) {
      missing++;
      pushDraft(missingDraft(transaction));
    }
  }

  // Pass 4 — diff findings against what is already stored.
  const desired = new Map<string, FingerprintedDraft>();
  for (const d of drafts) desired.set(d.fingerprint, d);

  const existingByFp = new Map<string, ExistingDiscrepancy>();
  for (const e of existingDiscrepancies) {
    const fp = e.fingerprint ?? `${e.discrepancy_type}:-:-`;
    existingByFp.set(fp, e);
  }

  const discrepancyInserts: FingerprintedDraft[] = [];
  const discrepancyUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const discrepancyDeleteIds: string[] = [];

  for (const [fp, draft] of desired) {
    const existing = existingByFp.get(fp);
    if (!existing) {
      discrepancyInserts.push(draft);
      events.push({
        transaction_id: draft.transaction_id,
        settlement_record_id: draft.settlement_record_id,
        event_type: "DISCREPANCY_OPENED",
        match_method: null,
        details: { type: draft.discrepancy_type, severity: draft.severity },
      });
      continue;
    }
    if (!materiallyDiffers(existing, draft)) continue; // unchanged: leave alone (incl. RESOLVED/IGNORED)

    discrepancyUpdates.push({
      id: existing.id,
      patch: {
        severity: draft.severity,
        currency: draft.currency,
        expected_amount_minor: draft.expected_amount_minor,
        actual_amount_minor: draft.actual_amount_minor,
        variance_amount_minor: draft.variance_amount_minor,
        reason: draft.reason,
        // A materially changed finding is live again.
        resolution_status: "OPEN",
        resolved_at: null,
      },
    });
    events.push({
      transaction_id: draft.transaction_id,
      settlement_record_id: draft.settlement_record_id,
      event_type: "DISCREPANCY_UPDATED",
      match_method: null,
      details: { type: draft.discrepancy_type, severity: draft.severity },
    });
  }

  for (const existing of existingDiscrepancies) {
    const fp = existing.fingerprint ?? `${existing.discrepancy_type}:-:-`;
    if (desired.has(fp)) continue;
    if (existing.resolution_status !== "OPEN") continue; // keep history
    discrepancyDeleteIds.push(existing.id);
    events.push({
      transaction_id: null,
      settlement_record_id: null,
      event_type: "DISCREPANCY_CLEARED",
      match_method: null,
      details: { type: existing.discrepancy_type, fingerprint: fp },
    });
  }

  return {
    matchUpdates,
    statusUpdates,
    discrepancyInserts,
    discrepancyUpdates,
    discrepancyDeleteIds,
    events,
    summary: {
      matched,
      ambiguous,
      orphaned,
      amountVariances,
      feeVariances,
      missing,
      statusCounts,
      ranAt: now.toISOString(),
    },
  };
}
