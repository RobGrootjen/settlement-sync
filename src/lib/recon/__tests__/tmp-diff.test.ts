import { describe, it, expect } from "vitest";
import { snapshotFiles, DEMO_DATASET_ID, DEMO_AS_OF } from "../dataset/snapshot";
import { CONTRACT_FEE_RULES } from "../dataset/fee-rules";
import { getAdapter } from "../processors";
import { parseCapturesCsv } from "../captures";
import { expectedSettlementDate } from "../dates";
import { planReconciliation, type ExistingDiscrepancy, type SettlementForPlan } from "../plan";
import type { ReconciliationStatus, TxnCandidate } from "../types";

type Row<T> = T & { dataset_id: string | null };

class Db {
  transactions: Row<TxnCandidate>[] = [];
  settlements: Row<SettlementForPlan>[] = [];
  discrepancies: Array<Row<ExistingDiscrepancy>> = [];
  events: Array<{ dataset_id: string | null; fingerprint: string }> = [];
  private seq = 0;
  private id = () => `r${++this.seq}`;

  /** Marker-only cleanup — mirrors clearDemoData(). */
  clearDataset(datasetId: string) {
    const keep = <T extends { dataset_id: string | null }>(rows: T[]) =>
      rows.filter((r) => r.dataset_id !== datasetId);
    this.discrepancies = keep(this.discrepancies);
    this.events = keep(this.events);
    this.settlements = keep(this.settlements);
    this.transactions = keep(this.transactions);
  }

  ingest(datasetId: string | null) {
    for (const file of snapshotFiles()) {
      if (file.processor === "CAPTURES") {
        for (const row of parseCapturesCsv(file.content)) {
          const existing = this.transactions.find((t) => t.transaction_id === row.transaction_id);
          const capture = row.capture_date ?? null;
          const record: Row<TxnCandidate> = {
            id: existing?.id ?? this.id(),
            dataset_id: datasetId,
            transaction_id: row.transaction_id,
            merchant_reference: row.merchant_reference ?? null,
            processor: row.processor,
            payment_method: row.payment_method as TxnCandidate["payment_method"],
            status: row.status as TxnCandidate["status"],
            currency: row.currency,
            captured_amount_minor:
              row.captured_amount_minor === null || row.captured_amount_minor === undefined
                ? null
                : Number(row.captured_amount_minor),
            capture_date: capture,
            expected_settlement_date: capture
              ? expectedSettlementDate(capture, row.payment_method).toISOString()
              : null,
            reconciliation_status: existing?.reconciliation_status ?? "NOT_DUE",
          };
          if (existing) Object.assign(existing, record);
          else this.transactions.push(record);
        }
        continue;
      }
      const { accepted, rejected } = getAdapter(file.processor).parse(file.content, file.filename);
      expect(rejected).toHaveLength(0);
      for (const row of accepted) {
        // Same natural key as the uq_settlement_dedupe index.
        const key = (s: { processor: string; processor_transaction_id: string | null; merchant_reference: string | null; settlement_date: string; gross_amount_minor: number }) =>
          [s.processor, s.processor_transaction_id, s.merchant_reference, s.settlement_date, s.gross_amount_minor].join("|");
        if (this.settlements.some((s) => key(s) === key(row))) continue;
        this.settlements.push({
          ...row,
          id: this.id(),
          dataset_id: datasetId,
          matched_transaction_id: null,
          match_method: null,
          match_confidence: null,
        });
      }
    }
  }

  reconcile(asOf: string, rematchAll: boolean) {
    const plan = planReconciliation({
      transactions: this.transactions,
      settlements: this.settlements,
      feeRules: CONTRACT_FEE_RULES,
      existingDiscrepancies: this.discrepancies,
      now: new Date(asOf),
      rematchAll,
    });
    for (const u of plan.matchUpdates) {
      const s = this.settlements.find((x) => x.id === u.id)!;
      s.matched_transaction_id = u.matched_transaction_id;
      s.match_method = u.match_method;
      s.match_confidence = u.match_confidence;
    }
    for (const u of plan.statusUpdates) {
      this.transactions.find((t) => t.id === u.id)!.reconciliation_status = u.status as ReconciliationStatus;
    }
    this.discrepancies = this.discrepancies.filter((d) => !plan.discrepancyDeleteIds.includes(d.id));
    for (const u of plan.discrepancyUpdates) Object.assign(this.discrepancies.find((d) => d.id === u.id)!, u.patch);
    const datasetOf = new Map<string, string | null>([
      ...this.transactions.map((t) => [t.id, t.dataset_id] as const),
      ...this.settlements.map((s) => [s.id, s.dataset_id] as const),
    ]);
    for (const d of plan.discrepancyInserts) {
      this.discrepancies.push({
        id: this.id(),
        dataset_id: datasetOf.get(d.transaction_id ?? "") ?? datasetOf.get(d.settlement_record_id ?? "") ?? null,
        fingerprint: d.fingerprint,
        discrepancy_type: d.discrepancy_type,
        severity: d.severity,
        currency: d.currency,
        expected_amount_minor: d.expected_amount_minor,
        actual_amount_minor: d.actual_amount_minor,
        variance_amount_minor: d.variance_amount_minor,
        reason: d.reason,
        resolution_status: "OPEN",
      });
    }
    for (const e of plan.events) {
      this.events.push({
        dataset_id: datasetOf.get(e.transaction_id ?? "") ?? datasetOf.get(e.settlement_record_id ?? "") ?? null,
        fingerprint: `${e.event_type}:${e.transaction_id ?? "-"}:${e.settlement_record_id ?? "-"}`,
      });
    }
    return plan;
  }

  /** Load demo dataset = clear by marker, ingest frozen files, reconcile at DEMO_AS_OF. */
  loadDemo() {
    this.clearDataset(DEMO_DATASET_ID);
    this.ingest(DEMO_DATASET_ID);
    return this.reconcile(DEMO_AS_OF, true);
  }

  snapshot() {
    return JSON.stringify({
      transactions: this.transactions
        .map((t) => [t.transaction_id, t.capture_date, t.expected_settlement_date, t.captured_amount_minor, t.reconciliation_status, t.dataset_id])
        .sort(),
      settlements: this.settlements
        .map((s) => [s.processor, s.processor_transaction_id, s.merchant_reference, s.settlement_date, s.gross_amount_minor, s.fee_amount_minor, s.match_method, s.dataset_id])
        .sort(),
      discrepancies: this.discrepancies.map((d) => [d.fingerprint, d.resolution_status, d.variance_amount_minor]).sort(),
    });
  }
}


describe("tmp", () => {
  it("diff", () => {
    const db = new Db();
    db.loadDemo();
    const a = db.snapshot();
    db.loadDemo();
    const b = db.snapshot();
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    console.log("DIFF@", i, "\nA:", a.slice(Math.max(0,i-200), i+200), "\nB:", b.slice(Math.max(0,i-200), i+200));
  });
});
