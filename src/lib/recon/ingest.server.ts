import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAdapter } from "./processors";
import { looksLikeCsv, parseCapturesCsv, type TransactionInput } from "./captures";
import { expectedSettlementDate } from "./dates";
import { parseMinor } from "./money";
import type { RowError } from "./types";

export interface IngestSummary {
  runId: string;
  processor: string;
  filename: string;
  recordCount: number;
  acceptedCount: number;
  rejectedCount: number;
  errors: RowError[];
}

/**
 * Parse a processor settlement file and persist the accepted rows.
 * Duplicate rows (same processor/ref/date/amount) are ignored, so re-uploading
 * the same file is a no-op rather than a double-count.
 */
export async function ingestSettlementFile(input: {
  processor: string;
  filename: string;
  content: string;
  /** Optional dataset marker; demo loads stamp every row so cleanup is safe. */
  datasetId?: string | null;
}): Promise<IngestSummary> {
  const adapter = getAdapter(input.processor);
  const { accepted, rejected, recordCount } = adapter.parse(input.content, input.filename);
  const errors = [...rejected];
  let insertedCount = 0;

  const datasetId = input.datasetId ?? null;
  const stamped = accepted.map((row) => ({ ...row, dataset_id: datasetId }));

  if (stamped.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("settlement_records")
      .upsert(stamped as never, {
        onConflict:
          "processor,processor_transaction_id,merchant_reference,settlement_date,gross_amount_minor",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      errors.push({ row: 0, reason: `database rejected batch: ${error.message}` });
    } else {
      insertedCount = data?.length ?? 0;
    }
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from("ingestion_runs")
    .insert({
      dataset_id: input.datasetId ?? null,
      processor: adapter.code,
      filename: input.filename,
      record_count: recordCount,
      accepted_count: accepted.length,
      rejected_count: errors.length,
      errors: errors as unknown as never,
    })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);

  return {
    runId: run.id,
    processor: adapter.code,
    filename: input.filename,
    recordCount,
    acceptedCount: insertedCount,
    rejectedCount: errors.length,
    errors,
  };
}

/**
 * Ingest capture-side transactions (JSON array). expected_settlement_date is
 * derived from capture_date + the payment-method settlement window when absent.
 */
export async function ingestTransactions(input: {
  filename: string;
  content: string;
  datasetId?: string | null;
}): Promise<IngestSummary> {
  const errors: RowError[] = [];
  let rows: TransactionInput[] = [];
  if (looksLikeCsv(input.content)) {
    try {
      rows = parseCapturesCsv(input.content);
    } catch (e) {
      errors.push({ row: 0, reason: `invalid CSV: ${(e as Error).message}` });
    }
  } else {
    try {
      const parsed = JSON.parse(input.content);
      rows = Array.isArray(parsed) ? parsed : (parsed.transactions ?? []);
    } catch (e) {
      errors.push({ row: 0, reason: `invalid JSON: ${(e as Error).message}` });
    }
  }

  const accepted: Record<string, unknown>[] = [];
  rows.forEach((row, i) => {
    try {
      if (!row.transaction_id) throw new Error("transaction_id is required");
      const amount =
        row.captured_amount_minor === null || row.captured_amount_minor === undefined
          ? null
          : parseMinor(row.captured_amount_minor);
      const captureDate = row.capture_date ? new Date(row.capture_date).toISOString() : null;
      accepted.push({
        dataset_id: input.datasetId ?? null,
        transaction_id: row.transaction_id,
        merchant_reference: row.merchant_reference ?? null,
        processor: row.processor,
        payment_method: row.payment_method,
        status: row.status,
        currency: row.currency,
        captured_amount_minor: amount,
        capture_date: captureDate,
        expected_settlement_date: captureDate
          ? expectedSettlementDate(captureDate, row.payment_method).toISOString()
          : null,
      });
    } catch (e) {
      errors.push({ row: i + 1, reason: (e as Error).message, raw: JSON.stringify(row) });
    }
  });

  let insertedCount = 0;
  if (accepted.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .upsert(accepted as never, { onConflict: "transaction_id" })
      .select("id");
    if (error) errors.push({ row: 0, reason: `database rejected batch: ${error.message}` });
    else insertedCount = data?.length ?? 0;
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from("ingestion_runs")
    .insert({
      dataset_id: input.datasetId ?? null,
      processor: "CAPTURES",
      filename: input.filename,
      record_count: rows.length,
      accepted_count: accepted.length,
      rejected_count: errors.length,
      errors: errors as unknown as never,
    })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);

  return {
    runId: run.id,
    processor: "CAPTURES",
    filename: input.filename,
    recordCount: rows.length,
    acceptedCount: insertedCount,
    rejectedCount: errors.length,
    errors,
  };
}
