import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateDataset, SNAPSHOT_ANCHOR, DATASET_FILENAMES } from "../dataset/generate";
import { CONTRACT_FEE_RULES } from "../dataset/fee-rules";
import { getAdapter } from "../processors";
import { parseCapturesCsv } from "../captures";
import { expectedSettlementDate } from "../dates";
import { planReconciliation, type SettlementForPlan } from "../plan";
import type { TxnCandidate } from "../types";

const ANCHOR = "2026-07-30";
const NOW = new Date(`${ANCHOR}T23:00:00Z`);

/** Runs the generated files through the real adapters and the real planner. */
function pipeline(anchor = ANCHOR, now = NOW) {
  const dataset = generateDataset(anchor);
  const captureFile = dataset.files.find((f) => f.processor === "CAPTURES")!;
  const transactions: TxnCandidate[] = parseCapturesCsv(captureFile.content).map((row, i) => ({
    id: `t${i}`,
    transaction_id: row.transaction_id,
    merchant_reference: row.merchant_reference ?? null,
    processor: row.processor,
    payment_method: row.payment_method as TxnCandidate["payment_method"],
    status: row.status as TxnCandidate["status"],
    currency: row.currency,
    captured_amount_minor: row.captured_amount_minor === null ? null : Number(row.captured_amount_minor),
    capture_date: row.capture_date ?? null,
    expected_settlement_date: row.capture_date
      ? expectedSettlementDate(row.capture_date, row.payment_method).toISOString()
      : null,
    reconciliation_status: "NOT_DUE",
  }));

  const settlements: SettlementForPlan[] = [];
  let rejected = 0;
  for (const file of dataset.files.filter((f) => f.processor !== "CAPTURES")) {
    const result = getAdapter(file.processor).parse(file.content, file.filename);
    rejected += result.rejected.length;
    result.accepted.forEach((row) =>
      settlements.push({
        ...row,
        id: `s${settlements.length}`,
        matched_transaction_id: null,
        match_method: null,
        match_confidence: null,
      }),
    );
  }

  const plan = planReconciliation({
    transactions,
    settlements,
    feeRules: CONTRACT_FEE_RULES,
    existingDiscrepancies: [],
    now,
    rematchAll: true,
  });

  return { dataset, transactions, settlements, plan, rejected };
}

describe("challenge dataset", () => {
  it("generates exactly 300 transactions across a 30-day window", () => {
    const { transactions, dataset } = pipeline();
    expect(transactions).toHaveLength(300);
    expect(dataset.expected.transactions).toBe(300);

    const dates = transactions
      .filter((t) => t.capture_date)
      .map((t) => Math.round((new Date(ANCHOR + "T00:00:00Z").getTime() - new Date(t.capture_date!).getTime()) / 86_400_000));
    expect(Math.min(...dates)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...dates)).toBeLessThanOrEqual(29);
  });

  it("covers all processors, currencies, methods and statuses", () => {
    const { transactions } = pipeline();
    const uniq = (fn: (t: TxnCandidate) => string) => new Set(transactions.map(fn));
    expect([...uniq((t) => t.processor)].sort()).toEqual(["MEKONGPAY", "NUSAPAY", "SIAMLINK"]);
    expect([...uniq((t) => t.currency)].sort()).toEqual(["IDR", "THB", "VND"]);
    expect([...uniq((t) => t.payment_method)].sort()).toEqual(["bank_transfer", "credit_card", "e_wallet"]);
    expect([...uniq((t) => t.status)].sort()).toEqual(["AUTHORIZED", "CANCELLED", "CAPTURED"]);
  });

  it("parses every settlement row through the three processor adapters", () => {
    const { settlements, rejected } = pipeline();
    expect(rejected).toBe(0);
    expect(settlements.length).toBe(66);
    expect(settlements.length).toBeGreaterThan(50);
    for (const processor of ["NUSAPAY", "SIAMLINK", "MEKONGPAY"]) {
      expect(settlements.filter((s) => s.processor === processor).length).toBeGreaterThan(0);
    }
  });

  it("produces the exact intentional scenario counts", () => {
    const { plan, dataset } = pipeline();
    expect(plan.summary.matched).toBe(dataset.expected.matched);
    expect(plan.summary.missing).toBe(4);
    expect(plan.summary.amountVariances).toBe(3);
    expect(plan.summary.feeVariances).toBe(2);
    expect(plan.summary.orphaned).toBe(3);
    expect(plan.summary.ambiguous).toBe(1);
    expect(plan.discrepancyInserts).toHaveLength(13);
  });

  it("matches the two anonymous rows via the amount + date window fallback", () => {
    const { plan } = pipeline();
    const fallback = plan.matchUpdates.filter((m) => m.match_method === "AMOUNT_DATE_WINDOW");
    expect(fallback).toHaveLength(2);
    expect(fallback.every((m) => m.match_confidence === 0.75)).toBe(true);
  });

  it("keeps most settlements clean", () => {
    const { plan } = pipeline();
    const dirty = 3 + 2 + 3 + 1; // amount + fee + orphan + ambiguous
    expect(plan.summary.matched - 5).toBe(57); // clean + fallback matches
    expect(dirty).toBeLessThan(plan.summary.matched);
  });

  it("is deterministic for a given anchor and seed", () => {
    const a = generateDataset(ANCHOR).files.map((f) => f.content).join("\n");
    const b = generateDataset(ANCHOR).files.map((f) => f.content).join("\n");
    expect(a).toBe(b);
  });

  it("holds the same scenario counts on any anchor date", () => {
    const { plan } = pipeline("2026-09-15", new Date("2026-09-15T23:00:00Z"));
    expect(plan.summary.missing).toBe(4);
    expect(plan.summary.orphaned).toBe(3);
    expect(plan.summary.ambiguous).toBe(1);
    expect(plan.summary.matched).toBe(62);
  });

  it("matches the committed snapshot in /sample-data", () => {
    const dataset = generateDataset(SNAPSHOT_ANCHOR);
    for (const key of Object.keys(DATASET_FILENAMES) as Array<keyof typeof DATASET_FILENAMES>) {
      const filename = DATASET_FILENAMES[key];
      const onDisk = readFileSync(`sample-data/${filename}`, "utf8").trimEnd();
      const generated = dataset.files.find((f) => f.filename === filename)!.content.trimEnd();
      expect(onDisk).toBe(generated);
    }
  });
});
