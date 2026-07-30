import type { FeeRule } from "../types";

/**
 * Mirror of the contractual fee rules seeded in processor_fee_rules.
 * Kept here so the dataset generator can produce settlements whose fees are
 * exactly on-contract (and therefore reconcile cleanly) without a DB round trip.
 */
export const CONTRACT_FEE_RULES: FeeRule[] = [
  { processor: "NUSAPAY", payment_method: "credit_card", currency: "IDR", fee_bps: 290, fixed_fee_minor: 200000, tolerance_minor: 0 },
  { processor: "NUSAPAY", payment_method: "bank_transfer", currency: "IDR", fee_bps: 100, fixed_fee_minor: 400000, tolerance_minor: 0 },
  { processor: "NUSAPAY", payment_method: "e_wallet", currency: "IDR", fee_bps: 150, fixed_fee_minor: 100000, tolerance_minor: 0 },
  { processor: "SIAMLINK", payment_method: "credit_card", currency: "THB", fee_bps: 275, fixed_fee_minor: 300, tolerance_minor: 0 },
  { processor: "SIAMLINK", payment_method: "bank_transfer", currency: "THB", fee_bps: 90, fixed_fee_minor: 1000, tolerance_minor: 0 },
  { processor: "SIAMLINK", payment_method: "e_wallet", currency: "THB", fee_bps: 180, fixed_fee_minor: 200, tolerance_minor: 0 },
  { processor: "MEKONGPAY", payment_method: "credit_card", currency: "VND", fee_bps: 300, fixed_fee_minor: 3000, tolerance_minor: 0 },
  { processor: "MEKONGPAY", payment_method: "bank_transfer", currency: "VND", fee_bps: 110, fixed_fee_minor: 5000, tolerance_minor: 0 },
  { processor: "MEKONGPAY", payment_method: "e_wallet", currency: "VND", fee_bps: 160, fixed_fee_minor: 2000, tolerance_minor: 0 },
];
