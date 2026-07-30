import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEMO_PREFIX, DATASET_FILENAMES } from "./dataset/generate";

/** Current dataset filenames plus the earlier hand-written fixture filenames,
 * so an older demo load is cleaned up too. */
const DEMO_FILENAMES = [
  ...(Object.values(DATASET_FILENAMES) as string[]),
  "captures.json",
  "nusapay_settlement.csv",
  "siamlink_batch.json",
  "mekongpay_settlement.txt",
];
const LEGACY_TXN_PREFIXES = ["NP-", "SL-", "MK-"];

/**
 * Remove ONLY demo-generated rows. Demo transactions and settlements carry the
 * DMO- prefix / known sample filenames, so operator-uploaded data is untouched.
 * Children (discrepancies, events) are deleted before their parents.
 */
export async function clearDemoData(): Promise<{ transactions: number; settlements: number }> {
  const [{ data: txns }, { data: settlements }] = await Promise.all([
    supabaseAdmin
      .from("transactions")
      .select("id")
      .or(
        [`transaction_id.like.${DEMO_PREFIX}%`, ...LEGACY_TXN_PREFIXES.map((p) => `transaction_id.like.${p}%`)].join(","),
      ),
    supabaseAdmin.from("settlement_records").select("id").in("source_filename", DEMO_FILENAMES),
  ]);

  const txnIds = (txns ?? []).map((t) => t.id);
  const settlementIds = (settlements ?? []).map((s) => s.id);

  for (const table of ["discrepancies", "reconciliation_events"] as const) {
    if (txnIds.length) {
      const { error } = await supabaseAdmin.from(table).delete().in("transaction_id", txnIds);
      if (error) throw new Error(error.message);
    }
    if (settlementIds.length) {
      const { error } = await supabaseAdmin.from(table).delete().in("settlement_record_id", settlementIds);
      if (error) throw new Error(error.message);
    }
  }

  if (settlementIds.length) {
    const { error } = await supabaseAdmin.from("settlement_records").delete().in("id", settlementIds);
    if (error) throw new Error(error.message);
  }
  if (txnIds.length) {
    const { error } = await supabaseAdmin.from("transactions").delete().in("id", txnIds);
    if (error) throw new Error(error.message);
  }
  await supabaseAdmin.from("ingestion_runs").delete().in("filename", DEMO_FILENAMES);

  return { transactions: txnIds.length, settlements: settlementIds.length };
}
