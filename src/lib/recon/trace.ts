/**
 * Pure trace explanation logic.
 *
 * The UI must never re-derive reconciliation outcomes; it renders what the
 * engine already wrote. This module only turns stored rows into a short,
 * human-readable justification, so it is trivially testable in isolation.
 */

export interface TraceTransaction {
  id: string;
  transaction_id: string;
  merchant_reference: string | null;
  processor: string;
  payment_method: string;
  status: string;
  currency: string;
  captured_amount_minor: number | null;
  capture_date: string | null;
  expected_settlement_date: string | null;
  reconciliation_status: string;
}

export interface TraceSettlement {
  id: string;
  processor: string;
  processor_transaction_id: string | null;
  merchant_reference: string | null;
  batch_id: string | null;
  currency: string;
  gross_amount_minor: number;
  fee_amount_minor: number;
  net_amount_minor: number;
  settlement_date: string;
  match_method: string | null;
  match_confidence: number | null;
  source_filename: string | null;
}

export interface TraceDiscrepancy {
  id: string;
  discrepancy_type: string;
  severity: string;
  resolution_status: string;
  reason: string | null;
  currency: string | null;
  expected_amount_minor: number | null;
  actual_amount_minor: number | null;
  variance_amount_minor: number | null;
  settlement_record_id: string | null;
}

export interface TraceEvent {
  id: string;
  created_at: string;
  event_type: string;
  match_method: string | null;
  settlement_record_id: string | null;
  details: unknown;
}

export interface TransactionTrace {
  found: boolean;
  matchedBy?: "transaction_id" | "merchant_reference";
  transaction: TraceTransaction | null;
  settlements: TraceSettlement[];
  discrepancies: TraceDiscrepancy[];
  events: TraceEvent[];
  explanation: string[];
}

export const MATCH_METHOD_LABEL: Record<string, string> = {
  EXACT_TXN_ID: "Tier 1 — exact processor transaction ID + processor (confidence 1.00)",
  EXACT_MERCHANT_REF: "Tier 2 — exact merchant reference + processor (confidence 0.95)",
  AMOUNT_DATE_WINDOW:
    "Tier 3 fallback — unique processor + currency + gross amount inside the settlement date window (confidence 0.75)",
};

/** Build the "why did this happen" narrative from stored rows only. */
export function explainTrace(input: {
  transaction: TraceTransaction;
  settlements: TraceSettlement[];
  discrepancies: TraceDiscrepancy[];
}): string[] {
  const { transaction: t, settlements, discrepancies } = input;
  const lines: string[] = [];
  const open = discrepancies.filter((d) => d.resolution_status === "OPEN");
  const has = (type: string) => open.some((d) => d.discrepancy_type === type);

  if (settlements.length > 0) {
    for (const s of settlements) {
      const label = s.match_method ? (MATCH_METHOD_LABEL[s.match_method] ?? s.match_method) : "unknown method";
      lines.push(`Matched to settlement ${s.processor_transaction_id ?? s.id} via ${label}.`);
    }
  } else {
    lines.push("No settlement record is currently matched to this transaction.");
  }

  if (has("AMBIGUOUS")) {
    lines.push(
      "A settlement matched more than one candidate transaction, so the matcher refused to guess and flagged it AMBIGUOUS for manual review.",
    );
  }

  switch (t.reconciliation_status) {
    case "NOT_DUE":
      lines.push(
        `Status NOT_DUE: the transaction is ${t.status}, so no settlement is expected from the processor.`,
      );
      break;
    case "PENDING":
      lines.push(
        `Status PENDING: captured but not yet settled, and the expected settlement date (${t.expected_settlement_date ?? "n/a"}) has not passed.`,
      );
      break;
    case "OVERDUE":
      lines.push(
        `Status OVERDUE: captured on ${t.capture_date ?? "n/a"} with a ${t.payment_method} window, expected settlement by ${t.expected_settlement_date ?? "n/a"}, and nothing has settled — a MISSING discrepancy was raised.`,
      );
      break;
    case "SETTLED":
      lines.push("Status SETTLED: settled gross matches the captured amount and the fee is inside contract tolerance.");
      break;
    case "VARIANCE": {
      const parts: string[] = [];
      if (has("AMOUNT_VARIANCE")) parts.push("the settled gross differs from the captured amount");
      if (has("FEE_VARIANCE")) parts.push("the processor fee differs from the contracted fee beyond tolerance");
      lines.push(
        `Status VARIANCE: matched, but ${parts.length ? parts.join(" and ") : "an amount or fee difference was recorded"}.`,
      );
      break;
    }
    default:
      lines.push(`Status ${t.reconciliation_status}.`);
  }

  if (open.length === 0) lines.push("No open discrepancies for this transaction.");
  return lines;
}

export function notFoundTrace(): TransactionTrace {
  return {
    found: false,
    transaction: null,
    settlements: [],
    discrepancies: [],
    events: [],
    explanation: ["No transaction found for that transaction ID or merchant reference."],
  };
}