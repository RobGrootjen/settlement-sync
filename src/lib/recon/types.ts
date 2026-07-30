/**
 * Domain types for the settlement reconciliation engine.
 * All monetary values are integer MINOR units. Never floats.
 */

export type Currency = "IDR" | "THB" | "VND";
export type PaymentMethod = "credit_card" | "bank_transfer" | "e_wallet";
export type TransactionStatus = "AUTHORIZED" | "CAPTURED" | "CANCELLED";
export type ReconciliationStatus =
  | "NOT_DUE"
  | "PENDING"
  | "SETTLED"
  | "OVERDUE"
  | "VARIANCE";

export type MatchMethod =
  | "EXACT_TXN_ID"
  | "EXACT_MERCHANT_REF"
  | "AMOUNT_DATE_WINDOW";

export type DiscrepancyType =
  | "MISSING"
  | "AMOUNT_VARIANCE"
  | "FEE_VARIANCE"
  | "ORPHANED"
  | "AMBIGUOUS";

export type Severity = "LOW" | "MEDIUM" | "HIGH";

/** Processor-agnostic settlement row produced by an adapter. */
export interface NormalizedSettlement {
  processor: string;
  batch_id: string | null;
  processor_transaction_id: string | null;
  merchant_reference: string | null;
  currency: Currency;
  gross_amount_minor: number;
  fee_amount_minor: number;
  net_amount_minor: number;
  settlement_date: string; // ISO
  source_filename: string | null;
  raw_payload: Record<string, unknown>;
}

export interface RowError {
  row: number;
  reason: string;
  /** JSON-encoded original row, kept as a string so it is always serializable. */
  raw?: string;
}

export interface ParseResult {
  accepted: NormalizedSettlement[];
  rejected: RowError[];
  recordCount: number;
}

/** Transaction shape the matcher needs (subset of the table). */
export interface TxnCandidate {
  id: string;
  transaction_id: string;
  merchant_reference: string | null;
  processor: string;
  payment_method: PaymentMethod;
  status: TransactionStatus;
  currency: string;
  captured_amount_minor: number | null;
  capture_date: string | null;
  expected_settlement_date: string | null;
  reconciliation_status: ReconciliationStatus;
}

export interface SettlementRow extends NormalizedSettlement {
  id: string;
  matched_transaction_id: string | null;
  match_method: MatchMethod | null;
  match_confidence: number | null;
}

export type MatchOutcome =
  | { kind: "MATCHED"; transaction: TxnCandidate; method: MatchMethod; confidence: number }
  | { kind: "AMBIGUOUS"; candidates: TxnCandidate[]; tier: MatchMethod }
  | { kind: "ORPHANED" };

export interface DiscrepancyDraft {
  transaction_id: string | null;
  settlement_record_id: string | null;
  discrepancy_type: DiscrepancyType;
  severity: Severity;
  currency: string | null;
  expected_amount_minor: number | null;
  actual_amount_minor: number | null;
  variance_amount_minor: number | null;
  reason: string;
}

export interface FeeRule {
  processor: string;
  payment_method: string;
  currency: string;
  fee_bps: number;
  fixed_fee_minor: number;
  tolerance_minor: number;
}