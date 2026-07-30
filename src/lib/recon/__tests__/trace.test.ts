import { describe, expect, it } from "vitest";
import { explainTrace, notFoundTrace, type TraceDiscrepancy, type TraceSettlement, type TraceTransaction } from "../trace";

const txn = (over: Partial<TraceTransaction>): TraceTransaction => ({
  id: "t1",
  transaction_id: "NP-0001",
  merchant_reference: "MC-0001",
  processor: "NUSAPAY",
  payment_method: "credit_card",
  status: "CAPTURED",
  currency: "IDR",
  captured_amount_minor: 1234567,
  capture_date: "2026-07-01T00:00:00.000Z",
  expected_settlement_date: "2026-07-04T00:00:00.000Z",
  reconciliation_status: "SETTLED",
  ...over,
});

const settlement = (over: Partial<TraceSettlement> = {}): TraceSettlement => ({
  id: "s1",
  processor: "NUSAPAY",
  processor_transaction_id: "NP-0001",
  merchant_reference: "MC-0001",
  batch_id: "B1",
  currency: "IDR",
  gross_amount_minor: 1234567,
  fee_amount_minor: 20000,
  net_amount_minor: 1214567,
  settlement_date: "2026-07-04T00:00:00.000Z",
  match_method: "EXACT_TXN_ID",
  match_confidence: 1,
  source_filename: "nusapay-settlements.csv",
  ...over,
});

const disc = (over: Partial<TraceDiscrepancy>): TraceDiscrepancy => ({
  id: "d1",
  discrepancy_type: "AMOUNT_VARIANCE",
  severity: "MEDIUM",
  resolution_status: "OPEN",
  reason: "delta",
  currency: "IDR",
  expected_amount_minor: 1234567,
  actual_amount_minor: 1230000,
  variance_amount_minor: -4567,
  settlement_record_id: "s1",
  ...over,
});

describe("explainTrace", () => {
  it("explains a settled transaction matched on tier 1", () => {
    const lines = explainTrace({ transaction: txn({}), settlements: [settlement()], discrepancies: [] });
    expect(lines.join(" ")).toContain("Tier 1");
    expect(lines.join(" ")).toContain("Status SETTLED");
    expect(lines.join(" ")).toContain("No open discrepancies");
  });

  it("explains a variance transaction with amount and fee findings", () => {
    const lines = explainTrace({
      transaction: txn({ reconciliation_status: "VARIANCE" }),
      settlements: [settlement({ gross_amount_minor: 1230000 })],
      discrepancies: [disc({}), disc({ id: "d2", discrepancy_type: "FEE_VARIANCE" })],
    });
    const text = lines.join(" ");
    expect(text).toContain("Status VARIANCE");
    expect(text).toContain("settled gross differs");
    expect(text).toContain("processor fee differs");
  });

  it("explains a missing/overdue transaction with no settlement", () => {
    const lines = explainTrace({
      transaction: txn({ reconciliation_status: "OVERDUE" }),
      settlements: [],
      discrepancies: [disc({ discrepancy_type: "MISSING", settlement_record_id: null })],
    });
    const text = lines.join(" ");
    expect(text).toContain("No settlement record is currently matched");
    expect(text).toContain("Status OVERDUE");
    expect(text).toContain("MISSING discrepancy");
  });

  it("explains an ambiguous settlement refusal", () => {
    const lines = explainTrace({
      transaction: txn({ reconciliation_status: "PENDING" }),
      settlements: [],
      discrepancies: [disc({ discrepancy_type: "AMBIGUOUS" })],
    });
    expect(lines.join(" ")).toContain("refused to guess");
  });

  it("returns a clear not-found trace", () => {
    const t = notFoundTrace();
    expect(t.found).toBe(false);
    expect(t.transaction).toBeNull();
    expect(t.explanation[0]).toContain("No transaction found");
  });
});
