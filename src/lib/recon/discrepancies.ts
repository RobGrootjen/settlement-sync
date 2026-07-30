import { expectedFeeMinor } from "./money";
import type {
  DiscrepancyDraft,
  FeeRule,
  NormalizedSettlement,
  Severity,
  TxnCandidate,
} from "./types";

/** Severity from the size of the variance relative to the expected amount. */
export function severityForVariance(varianceMinor: number, expectedMinor: number): Severity {
  const expected = Math.abs(expectedMinor);
  const variance = Math.abs(varianceMinor);
  if (expected === 0) return variance === 0 ? "LOW" : "HIGH";
  const ratio = variance / expected;
  if (ratio <= 0.01) return "LOW";
  if (ratio <= 0.05) return "MEDIUM";
  return "HIGH";
}

export function findFeeRule(
  rules: FeeRule[],
  processor: string,
  paymentMethod: string,
  currency: string,
): FeeRule | undefined {
  return rules.find(
    (r) => r.processor === processor && r.payment_method === paymentMethod && r.currency === currency,
  );
}

/**
 * Compare a matched settlement against its transaction.
 * Produces zero, one or two discrepancy drafts (amount and/or fee).
 */
export function evaluateMatch(args: {
  transaction: TxnCandidate;
  settlement: NormalizedSettlement & { id: string };
  feeRules: FeeRule[];
}): DiscrepancyDraft[] {
  const { transaction, settlement, feeRules } = args;
  const drafts: DiscrepancyDraft[] = [];
  const expectedAmount = transaction.captured_amount_minor ?? 0;
  const amountVariance = settlement.gross_amount_minor - expectedAmount;

  if (amountVariance !== 0) {
    drafts.push({
      transaction_id: transaction.id,
      settlement_record_id: settlement.id,
      discrepancy_type: "AMOUNT_VARIANCE",
      severity: severityForVariance(amountVariance, expectedAmount),
      currency: settlement.currency,
      expected_amount_minor: expectedAmount,
      actual_amount_minor: settlement.gross_amount_minor,
      variance_amount_minor: amountVariance,
      reason: `Settled gross differs from captured amount by ${amountVariance} minor units`,
    });
  }

  const rule = findFeeRule(feeRules, transaction.processor, transaction.payment_method, settlement.currency);
  if (rule) {
    const expectedFee = expectedFeeMinor(settlement.gross_amount_minor, rule.fee_bps, rule.fixed_fee_minor);
    const feeVariance = settlement.fee_amount_minor - expectedFee;
    if (Math.abs(feeVariance) > rule.tolerance_minor) {
      drafts.push({
        transaction_id: transaction.id,
        settlement_record_id: settlement.id,
        discrepancy_type: "FEE_VARIANCE",
        severity: severityForVariance(feeVariance, expectedFee),
        currency: settlement.currency,
        expected_amount_minor: expectedFee,
        actual_amount_minor: settlement.fee_amount_minor,
        variance_amount_minor: feeVariance,
        reason: `Fee differs from contracted ${rule.fee_bps}bps + ${rule.fixed_fee_minor} by ${feeVariance} minor units`,
      });
    }
  }

  return drafts;
}

export function orphanDraft(settlement: NormalizedSettlement & { id: string }): DiscrepancyDraft {
  return {
    transaction_id: null,
    settlement_record_id: settlement.id,
    discrepancy_type: "ORPHANED",
    severity: "HIGH",
    currency: settlement.currency,
    expected_amount_minor: null,
    actual_amount_minor: settlement.gross_amount_minor,
    variance_amount_minor: settlement.gross_amount_minor,
    reason: `No capture found for ${settlement.processor} settlement ${settlement.processor_transaction_id ?? settlement.merchant_reference}`,
  };
}

export function ambiguousDraft(
  settlement: NormalizedSettlement & { id: string },
  candidates: TxnCandidate[],
  tier: string,
): DiscrepancyDraft {
  return {
    transaction_id: null,
    settlement_record_id: settlement.id,
    discrepancy_type: "AMBIGUOUS",
    severity: "HIGH",
    currency: settlement.currency,
    expected_amount_minor: null,
    actual_amount_minor: settlement.gross_amount_minor,
    variance_amount_minor: null,
    reason: `${candidates.length} candidates at tier ${tier}: ${candidates.map((c) => c.transaction_id).join(", ")} — not matched automatically`,
  };
}

export function missingDraft(transaction: TxnCandidate): DiscrepancyDraft {
  const amount = transaction.captured_amount_minor ?? 0;
  return {
    transaction_id: transaction.id,
    settlement_record_id: null,
    discrepancy_type: "MISSING",
    severity: amount > 0 ? "HIGH" : "MEDIUM",
    currency: transaction.currency,
    expected_amount_minor: amount,
    actual_amount_minor: 0,
    variance_amount_minor: -amount,
    reason: `Captured ${transaction.transaction_id} is past its expected settlement date (${transaction.expected_settlement_date}) with no settlement record`,
  };
}