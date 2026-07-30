import { describe, expect, it } from "vitest";
import { expectedFeeMinor, formatMinor, parseMajorToMinor, parseMinor } from "../money";
import { matchSettlement } from "../matcher";
import { resolveStatus } from "../status";
import { severityForVariance } from "../discrepancies";
import { nusapayAdapter } from "../processors/nusapay";
import { mekongpayAdapter } from "../processors/mekongpay";
import { siamlinkAdapter } from "../processors/siamlink";
import type { NormalizedSettlement, TxnCandidate } from "../types";

const txn = (over: Partial<TxnCandidate>): TxnCandidate => ({
  id: over.id ?? "t1",
  transaction_id: over.transaction_id ?? "TX-1",
  merchant_reference: over.merchant_reference ?? null,
  processor: over.processor ?? "NUSAPAY",
  payment_method: over.payment_method ?? "credit_card",
  status: over.status ?? "CAPTURED",
  currency: over.currency ?? "IDR",
  captured_amount_minor: over.captured_amount_minor ?? 1000,
  capture_date: over.capture_date ?? "2026-07-01T00:00:00Z",
  expected_settlement_date: over.expected_settlement_date ?? "2026-07-04T00:00:00Z",
  reconciliation_status: over.reconciliation_status ?? "PENDING",
});

const settle = (over: Partial<NormalizedSettlement>): NormalizedSettlement => ({
  processor: "NUSAPAY",
  batch_id: null,
  processor_transaction_id: null,
  merchant_reference: null,
  currency: "IDR",
  gross_amount_minor: 1000,
  fee_amount_minor: 30,
  net_amount_minor: 970,
  settlement_date: "2026-07-03T00:00:00Z",
  source_filename: null,
  raw_payload: {},
  ...over,
});

describe("money", () => {
  it("parses major units per currency scale", () => {
    expect(parseMajorToMinor("1250.00", "THB")).toBe(125000);
    expect(parseMajorToMinor("250000", "IDR")).toBe(250000);
    expect(parseMajorToMinor("4,500,000", "VND")).toBe(4500000);
  });
  it("rejects impossible precision instead of rounding", () => {
    expect(() => parseMajorToMinor("100.5", "VND")).toThrow();
    expect(() => parseMajorToMinor("abc", "THB")).toThrow();
  });
  it("parses minor units strictly", () => {
    expect(parseMinor("4500000")).toBe(4500000);
    expect(() => parseMinor("45.00")).toThrow();
  });
  it("computes fees in integer space", () => {
    expect(expectedFeeMinor(1000000, 290, 200000)).toBe(229000);
  });
  it("formats with currency scale", () => {
    expect(formatMinor(125000, "THB")).toBe("1,250.00 THB");
    expect(formatMinor(4500000, "VND")).toBe("4,500,000 VND");
  });
});

describe("matcher", () => {
  it("tier 1: exact transaction id wins with confidence 1.00", () => {
    const out = matchSettlement(settle({ processor_transaction_id: "TX-1" }), [txn({})]);
    expect(out).toMatchObject({ kind: "MATCHED", method: "EXACT_TXN_ID", confidence: 1 });
  });
  it("tier 2: merchant reference at 0.95", () => {
    const out = matchSettlement(settle({ merchant_reference: "MC-9" }), [
      txn({ transaction_id: "OTHER", merchant_reference: "MC-9" }),
    ]);
    expect(out).toMatchObject({ kind: "MATCHED", method: "EXACT_MERCHANT_REF", confidence: 0.95 });
  });
  it("tier 3: amount + date window at 0.75", () => {
    const out = matchSettlement(settle({ processor_transaction_id: "NOPE" }), [txn({ transaction_id: "TX-9" })]);
    expect(out).toMatchObject({ kind: "MATCHED", method: "AMOUNT_DATE_WINDOW", confidence: 0.75 });
  });
  it("never guesses when multiple candidates exist", () => {
    const out = matchSettlement(settle({ processor_transaction_id: "NOPE" }), [
      txn({ id: "a", transaction_id: "TX-A" }),
      txn({ id: "b", transaction_id: "TX-B" }),
    ]);
    expect(out.kind).toBe("AMBIGUOUS");
  });
  it("marks orphan when nothing matches", () => {
    expect(matchSettlement(settle({ processor: "MEKONGPAY" }), [txn({})]).kind).toBe("ORPHANED");
  });
  it("rejects tier-3 candidates outside the settlement window", () => {
    const out = matchSettlement(
      settle({ processor_transaction_id: "NOPE", settlement_date: "2026-08-30T00:00:00Z" }),
      [txn({ transaction_id: "TX-9" })],
    );
    expect(out.kind).toBe("ORPHANED");
  });
});

describe("status rules", () => {
  const now = new Date("2026-07-10T00:00:00Z");
  it("authorized and cancelled are NOT_DUE", () => {
    expect(resolveStatus({ transaction: txn({ status: "AUTHORIZED" }), hasSettlement: false, hasVariance: false, now }).status).toBe("NOT_DUE");
    expect(resolveStatus({ transaction: txn({ status: "CANCELLED" }), hasSettlement: false, hasVariance: false, now }).status).toBe("NOT_DUE");
  });
  it("captured past due without settlement is OVERDUE and raises MISSING", () => {
    const out = resolveStatus({ transaction: txn({}), hasSettlement: false, hasVariance: false, now });
    expect(out).toEqual({ status: "OVERDUE", raiseMissing: true });
  });
  it("captured before due is PENDING", () => {
    const out = resolveStatus({
      transaction: txn({ expected_settlement_date: "2026-07-20T00:00:00Z" }),
      hasSettlement: false,
      hasVariance: false,
      now,
    });
    expect(out.status).toBe("PENDING");
  });
  it("matched clean is SETTLED, matched with delta is VARIANCE", () => {
    expect(resolveStatus({ transaction: txn({}), hasSettlement: true, hasVariance: false, now }).status).toBe("SETTLED");
    expect(resolveStatus({ transaction: txn({}), hasSettlement: true, hasVariance: true, now }).status).toBe("VARIANCE");
  });
});

describe("severity", () => {
  it("bands by ratio", () => {
    expect(severityForVariance(50, 10000)).toBe("LOW");
    expect(severityForVariance(300, 10000)).toBe("MEDIUM");
    expect(severityForVariance(3000, 10000)).toBe("HIGH");
  });
});

describe("adapters", () => {
  it("parses NusaPay CSV", () => {
    const result = nusapayAdapter.parse(
      "batch_id,txn_ref,merchant_ref,currency,gross,fee,net,settled_on\nB1,NP-1,MC-1,IDR,250000,7250,242750,2026-07-03",
      "f.csv",
    );
    expect(result.rejected).toHaveLength(0);
    expect(result.accepted[0]).toMatchObject({ gross_amount_minor: 250000, fee_amount_minor: 7250, net_amount_minor: 242750 });
  });
  it("rejects NusaPay rows where net does not reconcile", () => {
    const result = nusapayAdapter.parse(
      "batch_id,txn_ref,merchant_ref,currency,gross,fee,net,settled_on\nB1,NP-1,MC-1,IDR,250000,7250,1,2026-07-03",
      "f.csv",
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });
  it("parses SiamLink nested JSON with 2dp THB", () => {
    const result = siamlinkAdapter.parse(
      JSON.stringify({ batch: { id: "B", settled_at: "2026-07-03" }, items: [{ reference: "SL-1", order_id: "MC-1", currency: "THB", amount: "1250.00", fee: "95.00" }] }),
      "f.json",
    );
    expect(result.accepted[0]).toMatchObject({ gross_amount_minor: 125000, fee_amount_minor: 9500, net_amount_minor: 115500 });
  });
  it("parses MekongPay pipe file and derives fee", () => {
    const result = mekongpayAdapter.parse("H|B1|20260703\nD|MK-1|MC-1|VND|4500000|4362000|20260703\nT|1", "f.txt");
    expect(result.accepted[0]).toMatchObject({ batch_id: "B1", fee_amount_minor: 138000 });
  });
});