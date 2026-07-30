import { expectedSettlementDate } from "./dates";
import type { ReconciliationStatus, TxnCandidate } from "./types";

export interface StatusInput {
  transaction: TxnCandidate;
  hasSettlement: boolean;
  hasVariance: boolean;
  now: Date;
}

export interface StatusOutcome {
  status: ReconciliationStatus;
  /** True when an OVERDUE transaction should raise a MISSING discrepancy. */
  raiseMissing: boolean;
}

/**
 * Single source of truth for transaction reconciliation status.
 *   AUTHORIZED / CANCELLED            -> NOT_DUE
 *   CAPTURED, matched, clean          -> SETTLED
 *   CAPTURED, matched, any variance   -> VARIANCE
 *   CAPTURED, unmatched, before due   -> PENDING
 *   CAPTURED, unmatched, after due    -> OVERDUE (+ MISSING discrepancy)
 */
export function resolveStatus({ transaction, hasSettlement, hasVariance, now }: StatusInput): StatusOutcome {
  if (transaction.status === "AUTHORIZED" || transaction.status === "CANCELLED") {
    return { status: "NOT_DUE", raiseMissing: false };
  }
  if (hasSettlement) {
    return { status: hasVariance ? "VARIANCE" : "SETTLED", raiseMissing: false };
  }
  const due = transaction.expected_settlement_date
    ? new Date(transaction.expected_settlement_date)
    : transaction.capture_date
      ? expectedSettlementDate(transaction.capture_date, transaction.payment_method)
      : null;

  if (!due) return { status: "PENDING", raiseMissing: false };
  return now.getTime() > due.getTime()
    ? { status: "OVERDUE", raiseMissing: true }
    : { status: "PENDING", raiseMissing: false };
}