/**
 * Demo loader guarantees: frozen dataset, fixed clock, marker-only cleanup.
 *
 * The harness below mirrors what the server does (parse via the real adapters,
 * plan via the real planner, apply the plan) against an in-memory store, so we
 * can assert determinism and cleanup safety without a live database.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
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

  private label(id: string): string {
    const t = this.transactions.find((x) => x.id === id);
    if (t) return t.transaction_id;
    const st = this.settlements.find((x) => x.id === id);
    if (st) return [st.processor, st.processor_transaction_id, st.merchant_reference, st.settlement_date, st.gross_amount_minor].join("~");
    return id;
  }

  stableFingerprint(fingerprint: string | null): string {
    return (fingerprint ?? "").split(":").map((part) => (part === "-" ? part : this.label(part))).join(":");
  }

  snapshot() {
    return JSON.stringify({
      transactions: this.transactions
        .map((t) => [t.transaction_id, t.capture_date, t.expected_settlement_date, t.captured_amount_minor, t.reconciliation_status, t.dataset_id])
        .sort(),
      settlements: this.settlements
        .map((s) => [s.processor, s.processor_transaction_id, s.merchant_reference, s.settlement_date, s.gross_amount_minor, s.fee_amount_minor, s.match_method, s.dataset_id])
        .sort(),
      // Surrogate row ids are re-issued on every load (as in Postgres), so
      // fingerprints are compared through stable business keys.
      discrepancies: this.discrepancies
        .map((d) => [this.stableFingerprint(d.fingerprint), d.resolution_status, d.variance_amount_minor])
        .sort(),
    });
  }
}

afterEach(() => vi.useRealTimers());

describe("deterministic demo load", () => {
  it("uses the committed sample files verbatim", () => {
    const files = snapshotFiles();
    expect(files.map((f) => f.filename)).toEqual([
      "transactions.csv",
      "nusapay-settlements.csv",
      "siamlink-settlements.json",
      "mekongpay-settlements.txt",
    ]);
    expect(files.every((f) => f.content.length > 0)).toBe(true);
  });

  it("loads twice without duplicates and with identical results", () => {
    const db = new Db();
    const first = db.loadDemo();
    const afterFirst = db.snapshot();
    const counts = {
      transactions: db.transactions.length,
      settlements: db.settlements.length,
      discrepancies: db.discrepancies.length,
      events: db.events.length,
    };

    const second = db.loadDemo();
    expect(db.transactions).toHaveLength(counts.transactions);
    expect(db.settlements).toHaveLength(counts.settlements);
    expect(db.discrepancies).toHaveLength(counts.discrepancies);
    expect(db.events).toHaveLength(counts.events);
    expect(db.snapshot()).toBe(afterFirst);
    expect({ ...second.summary, ranAt: null }).toEqual({ ...first.summary, ranAt: null });
  });

  it("produces the same dataset regardless of the system date", () => {
    const run = (systemDate: string) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(systemDate));
      const db = new Db();
      const plan = db.loadDemo();
      vi.useRealTimers();
      return { snapshot: db.snapshot(), summary: { ...plan.summary, ranAt: null } };
    };
    const today = run("2026-07-30T10:00:00Z");
    const tomorrow = run("2026-07-31T10:00:00Z");
    const muchLater = run("2027-03-14T04:20:00Z");

    expect(tomorrow).toEqual(today);
    expect(muchLater).toEqual(today);
  });

  it("keeps reconciliation counts stable across repeated loads", () => {
    const db = new Db();
    const first = db.loadDemo();
    const second = db.loadDemo();
    for (const key of ["matched", "ambiguous", "orphaned", "amountVariances", "feeVariances", "missing"] as const) {
      expect(second.summary[key]).toBe(first.summary[key]);
    }
    expect(second.summary.statusCounts).toEqual(first.summary.statusCounts);
    expect(db.discrepancies.filter((d) => d.resolution_status === "OPEN")).toHaveLength(13);
  });

  it("never deletes non-demo records, even with NP-/SL-/MK-style identifiers", () => {
    const db = new Db();
    db.loadDemo();

    const userTxn: Row<TxnCandidate> = {
      id: "user-t1",
      dataset_id: null,
      transaction_id: "NP-1001",
      merchant_reference: "MK-REF-1",
      processor: "NUSAPAY",
      payment_method: "credit_card",
      status: "CAPTURED",
      currency: "IDR",
      captured_amount_minor: 123_457,
      capture_date: "2026-07-20T09:00:00Z",
      expected_settlement_date: "2026-07-23T09:00:00Z",
      reconciliation_status: "PENDING",
    };
    const userSettlement: Row<SettlementForPlan> = {
      id: "user-s1",
      dataset_id: null,
      processor: "SIAMLINK",
      batch_id: "SL-BATCH-1",
      processor_transaction_id: "SL-2002",
      merchant_reference: "NP-REF-2",
      currency: "THB",
      gross_amount_minor: 45_137,
      fee_amount_minor: 1_337,
      net_amount_minor: 43_800,
      settlement_date: "2026-07-28T12:00:00Z",
      source_filename: "transactions.csv", // same filename a demo file uses
      raw_payload: {},
      matched_transaction_id: null,
      match_method: null,
      match_confidence: null,
    };
    db.transactions.push(userTxn);
    db.settlements.push(userSettlement);
    db.discrepancies.push({
      id: "user-d1",
      dataset_id: null,
      fingerprint: "ORPHANED:-:user-s1",
      discrepancy_type: "ORPHANED",
      severity: "HIGH",
      currency: "THB",
      expected_amount_minor: null,
      actual_amount_minor: 45_137,
      variance_amount_minor: null,
      reason: "user upload",
      resolution_status: "OPEN",
    });
    db.events.push({ dataset_id: null, fingerprint: "USER_EVENT" });

    db.loadDemo();

    expect(db.transactions.find((t) => t.id === "user-t1")).toBeDefined();
    expect(db.settlements.find((s) => s.id === "user-s1")).toBeDefined();
    expect(db.events.some((e) => e.fingerprint === "USER_EVENT")).toBe(true);
    expect(db.discrepancies.some((d) => d.dataset_id === null)).toBe(true);
  });
});
