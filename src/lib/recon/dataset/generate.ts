/**
 * Deterministic challenge dataset generator.
 *
 * Given an anchor date (UTC midnight, "day 0") and a fixed seed, this produces
 * byte-identical capture + settlement files every time. Day offsets are
 * relative to the anchor so that the intentional scenario counts (overdue,
 * pending, etc.) stay stable no matter which day the demo is loaded.
 */
import { expectedFeeMinor } from "../money";
import { windowDays } from "../dates";
import { CONTRACT_FEE_RULES } from "./fee-rules";
import { mulberry32, randInt } from "./random";
import type { Currency, PaymentMethod } from "../types";

export const DATASET_SEED = 20260730;
/** Anchor used for the committed snapshot in /sample-data. */
export const SNAPSHOT_ANCHOR = "2026-07-30";
/** Every generated row is prefixed so demo data can be cleared surgically. */
export const DEMO_PREFIX = "DMO-";

export const DATASET_FILENAMES = {
  transactions: "transactions.csv",
  nusapay: "nusapay-settlements.csv",
  siamlink: "siamlink-settlements.json",
  mekongpay: "mekongpay-settlements.txt",
} as const;

const PROCESSORS = ["NUSAPAY", "SIAMLINK", "MEKONGPAY"] as const;
const CURRENCY_OF: Record<string, Currency> = { NUSAPAY: "IDR", SIAMLINK: "THB", MEKONGPAY: "VND" };
const METHODS: PaymentMethod[] = ["credit_card", "bank_transfer", "e_wallet"];

/** Intentional composition of the 300 transactions. */
export const SCENARIO_PLAN = {
  transactions: 300,
  cleanSettled: 55,
  amountVariance: 3,
  feeVariance: 2,
  fallbackMatch: 2,
  ambiguousCandidates: 2,
  overdueMissing: 4,
  pending: 92,
  authorized: 80,
  cancelled: 60,
  orphanSettlements: 3,
} as const;

export const EXPECTED_SETTLEMENTS =
  SCENARIO_PLAN.cleanSettled +
  SCENARIO_PLAN.amountVariance +
  SCENARIO_PLAN.feeVariance +
  SCENARIO_PLAN.fallbackMatch +
  1 /* ambiguous settlement */ +
  SCENARIO_PLAN.orphanSettlements;

type Role =
  | "clean"
  | "amount_variance"
  | "fee_variance"
  | "fallback"
  | "ambiguous"
  | "overdue"
  | "pending"
  | "authorized"
  | "cancelled";

export interface GeneratedTransaction {
  transaction_id: string;
  merchant_reference: string | null;
  processor: string;
  payment_method: PaymentMethod;
  status: "AUTHORIZED" | "CAPTURED" | "CANCELLED";
  currency: Currency;
  captured_amount_minor: number | null;
  capture_date: string | null;
  role: Role;
}

export interface GeneratedSettlement {
  processor: string;
  processor_transaction_id: string | null;
  merchant_reference: string | null;
  currency: Currency;
  gross_amount_minor: number;
  fee_amount_minor: number;
  settlement_date: string; // ISO
  batch_id: string;
  scenario: "clean" | "amount_variance" | "fee_variance" | "fallback" | "ambiguous" | "orphan";
}

export interface GeneratedDataset {
  anchor: string;
  transactions: GeneratedTransaction[];
  settlements: GeneratedSettlement[];
  files: { processor: string; filename: string; content: string }[];
  expected: {
    transactions: number;
    settlements: number;
    matched: number;
    missing: number;
    amountVariances: number;
    feeVariances: number;
    orphaned: number;
    ambiguous: number;
    fallbackMatches: number;
    openDiscrepancies: number;
  };
}

const DAY_MS = 86_400_000;

function anchorDate(anchor: string): Date {
  const d = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid anchor "${anchor}"`);
  return d;
}
function isoAt(anchor: string, daysAgo: number, hour = 9): string {
  return new Date(anchorDate(anchor).getTime() - daysAgo * DAY_MS + hour * 3600_000).toISOString();
}
const ymd = (iso: string) => iso.slice(0, 10);
const compact = (iso: string) => ymd(iso).replace(/-/g, "");

/** Currency-appropriate, deliberately non-round capture amounts. */
function amountFor(rng: () => number, currency: Currency): number {
  if (currency === "IDR") return randInt(rng, 6_000, 900_000) * 100 + randInt(rng, 137, 9_863);
  if (currency === "VND") return randInt(rng, 900, 190_000) * 100 + randInt(rng, 113, 9_887);
  return randInt(rng, 12_000, 480_000) + randInt(rng, 13, 97); // THB minor (2dp)
}

function feeFor(processor: string, method: PaymentMethod, currency: Currency, gross: number): number {
  const rule = CONTRACT_FEE_RULES.find(
    (r) => r.processor === processor && r.payment_method === method && r.currency === currency,
  );
  if (!rule) throw new Error(`no fee rule for ${processor}/${method}/${currency}`);
  return expectedFeeMinor(gross, rule.fee_bps, rule.fixed_fee_minor);
}

function roleSequence(): Role[] {
  const roles: Role[] = [];
  const push = (role: Role, n: number) => { for (let i = 0; i < n; i++) roles.push(role); };
  push("clean", SCENARIO_PLAN.cleanSettled);
  push("amount_variance", SCENARIO_PLAN.amountVariance);
  push("fee_variance", SCENARIO_PLAN.feeVariance);
  push("overdue", SCENARIO_PLAN.overdueMissing);
  push("pending", SCENARIO_PLAN.pending);
  push("authorized", SCENARIO_PLAN.authorized);
  push("cancelled", SCENARIO_PLAN.cancelled);
  return roles; // fallback + ambiguous transactions are appended explicitly
}

export function generateDataset(anchor: string, seed: number = DATASET_SEED): GeneratedDataset {
  const rng = mulberry32(seed);
  const transactions: GeneratedTransaction[] = [];
  const settlements: GeneratedSettlement[] = [];
  const usedAmounts = new Set<string>();

  /** Amounts must be unique per processor so tier-3 matching stays unambiguous. */
  const uniqueAmount = (processor: string, currency: Currency): number => {
    for (let i = 0; i < 1000; i++) {
      const value = amountFor(rng, currency);
      const key = `${processor}:${value}`;
      if (!usedAmounts.has(key)) { usedAmounts.add(key); return value; }
    }
    throw new Error("could not allocate a unique amount");
  };

  const roles = roleSequence();
  let seq = 0;
  const nextId = (processor: string) => {
    seq++;
    const tag = processor.slice(0, 2);
    return {
      transaction_id: `${DEMO_PREFIX}${tag}-${String(seq).padStart(4, "0")}`,
      merchant_reference: `${DEMO_PREFIX}MC-${String(seq).padStart(4, "0")}`,
    };
  };

  roles.forEach((role, i) => {
    const processor = PROCESSORS[i % 3];
    const currency = CURRENCY_OF[processor];
    const method = METHODS[Math.floor(i / 3) % 3];
    const win = windowDays(method);
    const { transaction_id, merchant_reference } = nextId(processor);

    if (role === "authorized" || role === "cancelled") {
      transactions.push({
        transaction_id,
        merchant_reference,
        processor,
        payment_method: method,
        status: role === "authorized" ? "AUTHORIZED" : "CANCELLED",
        currency,
        captured_amount_minor: null,
        capture_date: null,
        role,
      });
      return;
    }

    const gross = uniqueAmount(processor, currency);
    let captureOffset: number;
    if (role === "pending") captureOffset = randInt(rng, 0, win - 1);
    else if (role === "overdue") captureOffset = randInt(rng, 12, 28);
    else captureOffset = randInt(rng, 8, 29);

    const captureIso = isoAt(anchor, captureOffset);
    transactions.push({
      transaction_id,
      merchant_reference,
      processor,
      payment_method: method,
      status: "CAPTURED",
      currency,
      captured_amount_minor: gross,
      capture_date: captureIso,
      role,
    });

    if (role === "pending" || role === "overdue") return;

    const settlementIso = isoAt(anchor, Math.max(1, captureOffset - win), 12);
    const batch_id = `${DEMO_PREFIX}${processor.slice(0, 2)}-BATCH-${ymd(settlementIso).replace(/-/g, "")}`;

    if (role === "clean") {
      settlements.push({
        processor, processor_transaction_id: transaction_id, merchant_reference,
        currency, gross_amount_minor: gross, fee_amount_minor: feeFor(processor, method, currency, gross),
        settlement_date: settlementIso, batch_id, scenario: "clean",
      });
    } else if (role === "amount_variance") {
      // Processor short-settled by a non-round delta.
      const delta = currency === "THB" ? 1_337 : 17_431;
      const settledGross = gross - delta;
      settlements.push({
        processor, processor_transaction_id: transaction_id, merchant_reference,
        currency, gross_amount_minor: settledGross,
        fee_amount_minor: feeFor(processor, method, currency, settledGross),
        settlement_date: settlementIso, batch_id, scenario: "amount_variance",
      });
    } else {
      // fee_variance: correct gross, over-charged fee.
      const feeDelta = currency === "THB" ? 217 : 9_137;
      settlements.push({
        processor, processor_transaction_id: transaction_id, merchant_reference,
        currency, gross_amount_minor: gross,
        fee_amount_minor: feeFor(processor, method, currency, gross) + feeDelta,
        settlement_date: settlementIso, batch_id, scenario: "fee_variance",
      });
    }
  });

  // --- Fallback matches: settlement carries neither identifier; amount +
  // currency + date window must uniquely identify the capture (tier 3).
  const fallbackSpecs: Array<{ processor: (typeof PROCESSORS)[number]; method: PaymentMethod; offset: number }> = [
    { processor: "NUSAPAY", method: "credit_card", offset: 11 },
    { processor: "SIAMLINK", method: "bank_transfer", offset: 14 },
  ];
  for (const spec of fallbackSpecs) {
    const currency = CURRENCY_OF[spec.processor];
    const gross = uniqueAmount(spec.processor, currency);
    const { transaction_id, merchant_reference } = nextId(spec.processor);
    transactions.push({
      transaction_id, merchant_reference, processor: spec.processor, payment_method: spec.method,
      status: "CAPTURED", currency, captured_amount_minor: gross,
      capture_date: isoAt(anchor, spec.offset), role: "fallback",
    });
    const settlementIso = isoAt(anchor, spec.offset - windowDays(spec.method), 12);
    settlements.push({
      processor: spec.processor, processor_transaction_id: null, merchant_reference: null,
      currency, gross_amount_minor: gross,
      fee_amount_minor: feeFor(spec.processor, spec.method, currency, gross),
      settlement_date: settlementIso,
      batch_id: `${DEMO_PREFIX}${spec.processor.slice(0, 2)}-BATCH-${compact(settlementIso)}`,
      scenario: "fallback",
    });
  }

  // --- Ambiguous: two identical unsettled captures, one anonymous settlement.
  const ambProcessor = "MEKONGPAY";
  const ambCurrency = CURRENCY_OF[ambProcessor];
  const ambAmount = uniqueAmount(ambProcessor, ambCurrency);
  [1, 2].forEach((offset) => {
    const { transaction_id, merchant_reference } = nextId(ambProcessor);
    transactions.push({
      transaction_id, merchant_reference, processor: ambProcessor, payment_method: "credit_card",
      status: "CAPTURED", currency: ambCurrency, captured_amount_minor: ambAmount,
      capture_date: isoAt(anchor, offset), role: "ambiguous",
    });
  });
  const ambIso = isoAt(anchor, 0, 12);
  settlements.push({
    processor: ambProcessor, processor_transaction_id: null, merchant_reference: null,
    currency: ambCurrency, gross_amount_minor: ambAmount,
    fee_amount_minor: feeFor(ambProcessor, "credit_card", ambCurrency, ambAmount),
    settlement_date: ambIso, batch_id: `${DEMO_PREFIX}ME-BATCH-${compact(ambIso)}`, scenario: "ambiguous",
  });

  // --- Orphans: settlements with references that exist in no capture file.
  PROCESSORS.forEach((processor, i) => {
    const currency = CURRENCY_OF[processor];
    const gross = uniqueAmount(processor, currency);
    const iso = isoAt(anchor, 2 + i, 12);
    settlements.push({
      processor,
      processor_transaction_id: `${DEMO_PREFIX}ORPH-${processor.slice(0, 2)}-${i + 1}`,
      merchant_reference: `${DEMO_PREFIX}ORPH-REF-${i + 1}`,
      currency, gross_amount_minor: gross,
      fee_amount_minor: feeFor(processor, "e_wallet", currency, gross),
      settlement_date: iso, batch_id: `${DEMO_PREFIX}${processor.slice(0, 2)}-BATCH-${compact(iso)}`,
      scenario: "orphan",
    });
  });

  const files = [
    { processor: "CAPTURES", filename: DATASET_FILENAMES.transactions, content: renderTransactionsCsv(transactions) },
    { processor: "NUSAPAY", filename: DATASET_FILENAMES.nusapay, content: renderNusapayCsv(settlements) },
    { processor: "SIAMLINK", filename: DATASET_FILENAMES.siamlink, content: renderSiamlinkJson(settlements) },
    { processor: "MEKONGPAY", filename: DATASET_FILENAMES.mekongpay, content: renderMekongpayTxt(settlements) },
  ];

  const matched =
    SCENARIO_PLAN.cleanSettled + SCENARIO_PLAN.amountVariance + SCENARIO_PLAN.feeVariance + SCENARIO_PLAN.fallbackMatch;

  return {
    anchor,
    transactions,
    settlements,
    files,
    expected: {
      transactions: transactions.length,
      settlements: settlements.length,
      matched,
      missing: SCENARIO_PLAN.overdueMissing,
      amountVariances: SCENARIO_PLAN.amountVariance,
      feeVariances: SCENARIO_PLAN.feeVariance,
      orphaned: SCENARIO_PLAN.orphanSettlements,
      ambiguous: 1,
      fallbackMatches: SCENARIO_PLAN.fallbackMatch,
      openDiscrepancies:
        SCENARIO_PLAN.overdueMissing + SCENARIO_PLAN.amountVariance + SCENARIO_PLAN.feeVariance +
        SCENARIO_PLAN.orphanSettlements + 1,
    },
  };
}

/* ---------- file renderers (one per genuinely different processor format) ---------- */

function major(minor: number, currency: Currency): string {
  if (currency === "THB") {
    const sign = minor < 0 ? "-" : "";
    const abs = Math.abs(minor).toString().padStart(3, "0");
    return `${sign}${abs.slice(0, -2)}.${abs.slice(-2)}`;
  }
  return String(minor);
}

export function renderTransactionsCsv(rows: GeneratedTransaction[]): string {
  const header = "transaction_id,merchant_reference,processor,payment_method,status,currency,captured_amount_minor,capture_date";
  return [
    header,
    ...rows.map((t) =>
      [
        t.transaction_id, t.merchant_reference ?? "", t.processor, t.payment_method, t.status, t.currency,
        t.captured_amount_minor ?? "", t.capture_date ?? "",
      ].join(","),
    ),
  ].join("\n");
}

export function renderNusapayCsv(all: GeneratedSettlement[]): string {
  const rows = all.filter((s) => s.processor === "NUSAPAY");
  return [
    "batch_id,txn_ref,merchant_ref,currency,gross,fee,net,settled_on",
    ...rows.map((s) =>
      [
        s.batch_id, s.processor_transaction_id ?? "", s.merchant_reference ?? "", s.currency,
        major(s.gross_amount_minor, s.currency), major(s.fee_amount_minor, s.currency),
        major(s.gross_amount_minor - s.fee_amount_minor, s.currency), ymd(s.settlement_date),
      ].join(","),
    ),
  ].join("\n");
}

export function renderSiamlinkJson(all: GeneratedSettlement[]): string {
  const rows = all.filter((s) => s.processor === "SIAMLINK");
  return JSON.stringify(
    {
      batch: { id: rows[0]?.batch_id ?? `${DEMO_PREFIX}SI-BATCH`, settled_at: ymd(rows[0]?.settlement_date ?? new Date().toISOString()) },
      items: rows.map((s) => ({
        reference: s.processor_transaction_id,
        order_id: s.merchant_reference,
        currency: s.currency,
        amount: major(s.gross_amount_minor, s.currency),
        fee: major(s.fee_amount_minor, s.currency),
        settled_at: ymd(s.settlement_date),
      })),
    },
    null,
    2,
  );
}

export function renderMekongpayTxt(all: GeneratedSettlement[]): string {
  const rows = all.filter((s) => s.processor === "MEKONGPAY");
  const batch = rows[0]?.batch_id ?? `${DEMO_PREFIX}ME-BATCH`;
  return [
    `H|${batch}|${compact(rows[0]?.settlement_date ?? new Date().toISOString())}`,
    ...rows.map((s) =>
      [
        "D", s.processor_transaction_id ?? "", s.merchant_reference ?? "", s.currency,
        String(s.gross_amount_minor), String(s.gross_amount_minor - s.fee_amount_minor),
        compact(s.settlement_date),
      ].join("|"),
    ),
    `T|${rows.length}`,
  ].join("\n");
}

/** UTC midnight of today — the anchor used when loading the demo at runtime. */
export function todayAnchor(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
