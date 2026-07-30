import { withinMatchWindow } from "./dates";
import type { MatchOutcome, NormalizedSettlement, TxnCandidate } from "./types";

export const MATCH_CONFIDENCE = {
  EXACT_TXN_ID: 1.0,
  EXACT_MERCHANT_REF: 0.95,
  AMOUNT_DATE_WINDOW: 0.75,
} as const;

/**
 * Deterministic 4-tier matcher. Pure function: give it a settlement and the
 * pool of transactions, get an outcome. Never guesses — multiple candidates at
 * any tier short-circuits to AMBIGUOUS.
 */
export function matchSettlement(
  settlement: Pick<
    NormalizedSettlement,
    "processor" | "processor_transaction_id" | "merchant_reference" | "currency" | "gross_amount_minor" | "settlement_date"
  >,
  transactions: TxnCandidate[],
  options: { excludeTransactionIds?: Set<string> } = {},
): MatchOutcome {
  const excluded = options.excludeTransactionIds ?? new Set<string>();
  const pool = transactions.filter(
    (t) => t.processor === settlement.processor && !excluded.has(t.id),
  );

  // Tier 1 — exact transaction id + processor
  if (settlement.processor_transaction_id) {
    const hits = pool.filter((t) => t.transaction_id === settlement.processor_transaction_id);
    if (hits.length === 1) {
      return { kind: "MATCHED", transaction: hits[0], method: "EXACT_TXN_ID", confidence: MATCH_CONFIDENCE.EXACT_TXN_ID };
    }
    if (hits.length > 1) return { kind: "AMBIGUOUS", candidates: hits, tier: "EXACT_TXN_ID" };
  }

  // Tier 2 — exact merchant reference + processor
  if (settlement.merchant_reference) {
    const hits = pool.filter(
      (t) => t.merchant_reference && t.merchant_reference === settlement.merchant_reference,
    );
    if (hits.length === 1) {
      return { kind: "MATCHED", transaction: hits[0], method: "EXACT_MERCHANT_REF", confidence: MATCH_CONFIDENCE.EXACT_MERCHANT_REF };
    }
    if (hits.length > 1) return { kind: "AMBIGUOUS", candidates: hits, tier: "EXACT_MERCHANT_REF" };
  }

  // Tier 3 — currency + gross amount + valid settlement window
  const fuzzy = pool.filter(
    (t) =>
      t.status === "CAPTURED" &&
      t.currency === settlement.currency &&
      t.captured_amount_minor === settlement.gross_amount_minor &&
      withinMatchWindow(t.capture_date, t.payment_method, settlement.settlement_date),
  );
  if (fuzzy.length === 1) {
    return { kind: "MATCHED", transaction: fuzzy[0], method: "AMOUNT_DATE_WINDOW", confidence: MATCH_CONFIDENCE.AMOUNT_DATE_WINDOW };
  }
  if (fuzzy.length > 1) return { kind: "AMBIGUOUS", candidates: fuzzy, tier: "AMOUNT_DATE_WINDOW" };

  // Tier 4 — nothing to attach to
  return { kind: "ORPHANED" };
}