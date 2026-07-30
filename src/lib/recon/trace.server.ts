import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  explainTrace,
  notFoundTrace,
  type TraceDiscrepancy,
  type TraceEvent,
  type TraceSettlement,
  type TraceTransaction,
  type TransactionTrace,
} from "./trace";

const TXN_COLUMNS =
  "id,transaction_id,merchant_reference,processor,payment_method,status,currency,captured_amount_minor,capture_date,expected_settlement_date,reconciliation_status";
const SETTLEMENT_COLUMNS =
  "id,processor,processor_transaction_id,merchant_reference,batch_id,currency,gross_amount_minor,fee_amount_minor,net_amount_minor,settlement_date,match_method,match_confidence,source_filename";

/**
 * Read-only investigation query: original transaction, its matched settlements,
 * related discrepancies and the chronological audit trail. No reconciliation
 * logic runs here — everything is read back from what the engine persisted.
 */
export async function traceTransaction(input: { query: string }): Promise<TransactionTrace> {
  const q = input.query.trim();
  if (!q) return notFoundTrace();

  let matchedBy: "transaction_id" | "merchant_reference" = "transaction_id";
  const primary = await supabaseAdmin
    .from("transactions")
    .select(TXN_COLUMNS)
    .eq("transaction_id", q)
    .maybeSingle();
  if (primary.error) throw new Error(primary.error.message);

  let txn = primary.data;
  if (!txn) {
    const fallback = await supabaseAdmin
      .from("transactions")
      .select(TXN_COLUMNS)
      .eq("merchant_reference", q)
      .limit(1);
    if (fallback.error) throw new Error(fallback.error.message);
    txn = fallback.data?.[0] ?? null;
    matchedBy = "merchant_reference";
  }
  if (!txn) return notFoundTrace();

  const transaction = txn as TraceTransaction;

  const { data: settlements, error: sErr } = await supabaseAdmin
    .from("settlement_records")
    .select(SETTLEMENT_COLUMNS)
    .eq("matched_transaction_id", transaction.id)
    .order("settlement_date", { ascending: true });
  if (sErr) throw new Error(sErr.message);

  const settlementIds = (settlements ?? []).map((s) => s.id);
  const filter = settlementIds.length
    ? `transaction_id.eq.${transaction.id},settlement_record_id.in.(${settlementIds.join(",")})`
    : `transaction_id.eq.${transaction.id}`;

  const { data: discrepancies, error: dErr } = await supabaseAdmin
    .from("discrepancies")
    .select(
      "id,discrepancy_type,severity,resolution_status,reason,currency,expected_amount_minor,actual_amount_minor,variance_amount_minor,settlement_record_id,created_at,resolved_at",
    )
    .or(filter)
    .order("created_at", { ascending: true });
  if (dErr) throw new Error(dErr.message);

  const { data: events, error: eErr } = await supabaseAdmin
    .from("reconciliation_events")
    .select("id,created_at,event_type,match_method,settlement_record_id,details")
    .or(filter)
    .order("created_at", { ascending: true });
  if (eErr) throw new Error(eErr.message);

  const typedSettlements = (settlements ?? []) as TraceSettlement[];
  const typedDiscrepancies = (discrepancies ?? []) as TraceDiscrepancy[];

  return {
    found: true,
    matchedBy,
    transaction,
    settlements: typedSettlements,
    discrepancies: typedDiscrepancies,
    events: (events ?? []) as TraceEvent[],
    explanation: explainTrace({
      transaction,
      settlements: typedSettlements,
      discrepancies: typedDiscrepancies,
    }),
  };
}
