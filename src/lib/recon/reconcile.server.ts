import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { matchSettlement } from "./matcher";
import {
  ambiguousDraft,
  evaluateMatch,
  missingDraft,
  orphanDraft,
} from "./discrepancies";
import { resolveStatus } from "./status";
import type {
  DiscrepancyDraft,
  FeeRule,
  NormalizedSettlement,
  ReconciliationStatus,
  TxnCandidate,
} from "./types";

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

type EventRow = {
  transaction_id: string | null;
  settlement_record_id: string | null;
  event_type: string;
  match_method: string | null;
  details: unknown;
};

/**
 * Full reconciliation pass. Idempotent: it clears OPEN auto-generated findings
 * first (resolved/ignored history is preserved), then rebuilds matches,
 * discrepancies and transaction statuses from the current data.
 */
export async function runReconciliation(options: { rematchAll?: boolean } = {}): Promise<ReconciliationSummary> {
  const now = new Date();

  const [{ data: txnData, error: txnError }, { data: settlementData, error: settlementError }, { data: ruleData }] =
    await Promise.all([
      supabaseAdmin
        .from("transactions")
        .select(
          "id,transaction_id,merchant_reference,processor,payment_method,status,currency,captured_amount_minor,capture_date,expected_settlement_date,reconciliation_status",
        ),
      supabaseAdmin
        .from("settlement_records")
        .select(
          "id,processor,batch_id,processor_transaction_id,merchant_reference,currency,gross_amount_minor,fee_amount_minor,net_amount_minor,settlement_date,source_filename,matched_transaction_id,match_method,match_confidence",
        )
        .order("settlement_date", { ascending: true }),
      supabaseAdmin.from("processor_fee_rules").select("*"),
    ]);

  if (txnError) throw new Error(txnError.message);
  if (settlementError) throw new Error(settlementError.message);

  const transactions = (txnData ?? []) as unknown as TxnCandidate[];
  const settlements = (settlementData ?? []) as unknown as Array<
    NormalizedSettlement & { id: string; matched_transaction_id: string | null }
  >;
  const feeRules = (ruleData ?? []) as unknown as FeeRule[];

  // Clear open auto-generated findings so re-running never duplicates them.
  await supabaseAdmin.from("discrepancies").delete().eq("resolution_status", "OPEN");

  const drafts: DiscrepancyDraft[] = [];
  const events: EventRow[] = [];
  const claimed = new Set<string>();
  const matchedTxnIds = new Set<string>();
  const varianceTxnIds = new Set<string>();
  const matchUpdates: Array<{ id: string; matched_transaction_id: string | null; match_method: string | null; match_confidence: number | null }> = [];

  let matched = 0;
  let ambiguous = 0;
  let orphaned = 0;
  let amountVariances = 0;
  let feeVariances = 0;

  for (const settlement of settlements) {
    // Honour previously confirmed matches unless a full rematch was requested.
    if (!options.rematchAll && settlement.matched_transaction_id) {
      claimed.add(settlement.matched_transaction_id);
    }
  }

  for (const settlement of settlements) {
    const outcome = matchSettlement(settlement, transactions, { excludeTransactionIds: claimed });

    if (outcome.kind === "MATCHED") {
      matched++;
      claimed.add(outcome.transaction.id);
      matchedTxnIds.add(outcome.transaction.id);
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

      const variances = evaluateMatch({ transaction: outcome.transaction, settlement, feeRules });
      for (const v of variances) {
        if (v.discrepancy_type === "AMOUNT_VARIANCE") amountVariances++;
        if (v.discrepancy_type === "FEE_VARIANCE") feeVariances++;
        varianceTxnIds.add(outcome.transaction.id);
      }
      drafts.push(...variances);
      continue;
    }

    matchUpdates.push({ id: settlement.id, matched_transaction_id: null, match_method: null, match_confidence: null });

    if (outcome.kind === "AMBIGUOUS") {
      ambiguous++;
      drafts.push(ambiguousDraft(settlement, outcome.candidates, outcome.tier));
      events.push({
        transaction_id: null,
        settlement_record_id: settlement.id,
        event_type: "AMBIGUOUS",
        match_method: outcome.tier,
        details: { candidates: outcome.candidates.map((c) => c.transaction_id) },
      });
    } else {
      orphaned++;
      drafts.push(orphanDraft(settlement));
      events.push({
        transaction_id: null,
        settlement_record_id: settlement.id,
        event_type: "ORPHANED",
        match_method: null,
        details: { processor: settlement.processor },
      });
    }
  }

  // Transaction status sweep
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
      drafts.push(missingDraft(transaction));
    }
  }

  await applyMatchUpdates(matchUpdates);
  await applyStatusUpdates(statusUpdates);

  if (drafts.length > 0) {
    const { error } = await supabaseAdmin.from("discrepancies").insert(drafts as never);
    if (error) throw new Error(error.message);
  }
  if (events.length > 0) {
    const { error } = await supabaseAdmin.from("reconciliation_events").insert(events as never);
    if (error) throw new Error(error.message);
  }

  return {
    matched,
    ambiguous,
    orphaned,
    amountVariances,
    feeVariances,
    missing,
    statusCounts,
    ranAt: now.toISOString(),
  };
}

async function applyMatchUpdates(
  updates: Array<{ id: string; matched_transaction_id: string | null; match_method: string | null; match_confidence: number | null }>,
) {
  for (const chunk of chunked(updates, 50)) {
    await Promise.all(
      chunk.map((u) =>
        supabaseAdmin
          .from("settlement_records")
          .update({
            matched_transaction_id: u.matched_transaction_id,
            match_method: u.match_method,
            match_confidence: u.match_confidence,
          })
          .eq("id", u.id),
      ),
    );
  }
}

async function applyStatusUpdates(updates: Array<{ id: string; status: ReconciliationStatus }>) {
  for (const chunk of chunked(updates, 50)) {
    await Promise.all(
      chunk.map((u) =>
        supabaseAdmin.from("transactions").update({ reconciliation_status: u.status }).eq("id", u.id),
      ),
    );
  }
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}