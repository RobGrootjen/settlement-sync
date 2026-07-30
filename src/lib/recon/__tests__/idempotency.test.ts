import { describe, expect, it } from "vitest";
import { planReconciliation, type ExistingDiscrepancy, type SettlementForPlan } from "../plan";
import type { FeeRule, ReconciliationStatus, TxnCandidate } from "../types";

const NOW = new Date("2026-07-10T00:00:00Z");

const feeRules: FeeRule[] = [
  { processor: "NUSAPAY", payment_method: "credit_card", currency: "IDR", fee_bps: 290, fixed_fee_minor: 2000, tolerance_minor: 100 },
];

function txn(over: Partial<TxnCandidate>): TxnCandidate {
  return {
    id: over.id ?? "t1",
    transaction_id: over.transaction_id ?? "TX-1",
    merchant_reference: over.merchant_reference ?? null,
    processor: over.processor ?? "NUSAPAY",
    payment_method: over.payment_method ?? "credit_card",
    status: over.status ?? "CAPTURED",
    currency: over.currency ?? "IDR",
    captured_amount_minor: over.captured_amount_minor ?? 250000,
    capture_date: over.capture_date ?? "2026-07-01T00:00:00Z",
    expected_settlement_date: over.expected_settlement_date ?? "2026-07-04T00:00:00Z",
    reconciliation_status: over.reconciliation_status ?? "PENDING",
  };
}

function settlement(over: Partial<SettlementForPlan>): SettlementForPlan {
  return {
    id: over.id ?? "s1",
    processor: over.processor ?? "NUSAPAY",
    batch_id: over.batch_id ?? "B1",
    processor_transaction_id: over.processor_transaction_id ?? "TX-1",
    merchant_reference: over.merchant_reference ?? null,
    currency: over.currency ?? "IDR",
    gross_amount_minor: over.gross_amount_minor ?? 250000,
    fee_amount_minor: over.fee_amount_minor ?? 9250,
    net_amount_minor: over.net_amount_minor ?? 240750,
    settlement_date: over.settlement_date ?? "2026-07-03T00:00:00Z",
    source_filename: over.source_filename ?? "f.csv",
    raw_payload: {},
    matched_transaction_id: over.matched_transaction_id ?? null,
    match_method: over.match_method ?? null,
    match_confidence: over.match_confidence ?? null,
  };
}

/** In-memory store that applies a plan the same way the server does. */
class Store {
  transactions: TxnCandidate[];
  settlements: SettlementForPlan[];
  discrepancies: ExistingDiscrepancy[] = [];
  eventCount = 0;
  private seq = 0;

  constructor(transactions: TxnCandidate[], settlements: SettlementForPlan[]) {
    this.transactions = transactions;
    this.settlements = settlements;
  }

  run(rematchAll = false) {
    const plan = planReconciliation({
      transactions: this.transactions,
      settlements: this.settlements,
      feeRules,
      existingDiscrepancies: this.discrepancies,
      now: NOW,
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
    for (const u of plan.discrepancyUpdates) {
      const d = this.discrepancies.find((x) => x.id === u.id)!;
      Object.assign(d, u.patch);
    }
    for (const d of plan.discrepancyInserts) {
      this.discrepancies.push({
        id: `d${++this.seq}`,
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
    this.eventCount += plan.events.length;
    return plan;
  }
}

function fixture() {
  return new Store(
    [
      txn({ id: "t1", transaction_id: "TX-1", merchant_reference: "MC-1" }),
      // clean match via merchant ref
      txn({ id: "t2", transaction_id: "TX-2", merchant_reference: "MC-2" }),
      // overdue, never settled -> MISSING
      txn({ id: "t3", transaction_id: "TX-3", expected_settlement_date: "2026-07-02T00:00:00Z" }),
      txn({ id: "t4", transaction_id: "TX-4", status: "AUTHORIZED" }),
    ],
    [
      settlement({ id: "s1", processor_transaction_id: "TX-1" }),
      // amount variance
      settlement({ id: "s2", processor_transaction_id: "TX-2", gross_amount_minor: 249000, fee_amount_minor: 9221, net_amount_minor: 239779 }),
      // orphan
      settlement({ id: "s3", processor_transaction_id: "TX-999", gross_amount_minor: 777, fee_amount_minor: 0, net_amount_minor: 777 }),
    ],
  );
}

describe("reconciliation idempotency", () => {
  it("keeps existing matches on a second run and never re-matches them", () => {
    const store = fixture();
    store.run();
    expect(store.settlements[0].matched_transaction_id).toBe("t1");
    expect(store.settlements[1].matched_transaction_id).toBe("t2");

    const second = store.run();
    expect(store.settlements[0].matched_transaction_id).toBe("t1");
    expect(store.settlements[1].matched_transaction_id).toBe("t2");
    expect(second.matchUpdates).toHaveLength(0);
  });

  it("produces identical summaries and statuses across runs", () => {
    const store = fixture();
    const first = store.run();
    const statusesAfterFirst = store.transactions.map((t) => t.reconciliation_status);
    const second = store.run();

    expect({ ...second.summary, ranAt: null }).toEqual({ ...first.summary, ranAt: null });
    expect(store.transactions.map((t) => t.reconciliation_status)).toEqual(statusesAfterFirst);
    expect(second.statusUpdates).toHaveLength(0);
  });

  it("does not grow discrepancy or event counts on an unchanged second run", () => {
    const store = fixture();
    store.run();
    const discrepancies = store.discrepancies.length;
    const events = store.eventCount;
    expect(discrepancies).toBeGreaterThan(0);
    expect(events).toBeGreaterThan(0);

    const second = store.run();
    expect(second.events).toHaveLength(0);
    expect(second.discrepancyInserts).toHaveLength(0);
    expect(second.discrepancyUpdates).toHaveLength(0);
    expect(second.discrepancyDeleteIds).toHaveLength(0);
    expect(store.discrepancies).toHaveLength(discrepancies);
    expect(store.eventCount).toBe(events);
  });

  it("preserves resolved findings and does not recreate them", () => {
    const store = fixture();
    store.run();
    const target = store.discrepancies.find((d) => d.discrepancy_type === "ORPHANED")!;
    target.resolution_status = "RESOLVED";
    const before = store.discrepancies.length;

    store.run();
    expect(store.discrepancies).toHaveLength(before);
    expect(store.discrepancies.find((d) => d.id === target.id)!.resolution_status).toBe("RESOLVED");
  });

  it("rematchAll recomputes matches deliberately", () => {
    const store = fixture();
    store.run();
    // Corrupt a stored match; a normal run preserves it, rematchAll fixes it.
    store.settlements[0].matched_transaction_id = "t3";
    store.settlements[0].match_method = "EXACT_TXN_ID";
    store.settlements[0].match_confidence = 1;

    const preserving = store.run();
    expect(preserving.matchUpdates).toHaveLength(0);
    expect(store.settlements[0].matched_transaction_id).toBe("t3");

    const rematched = store.run(true);
    expect(rematched.matchUpdates.some((u) => u.id === "s1" && u.matched_transaction_id === "t1")).toBe(true);
    expect(store.settlements[0].matched_transaction_id).toBe("t1");
  });
});
