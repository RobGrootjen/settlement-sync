import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEMO_DATASET_ID } from "./dataset/snapshot";

/**
 * Remove ONLY rows carrying the demo dataset marker.
 *
 * Cleanup is marker-based on purpose: filenames, `NP-`/`SL-`/`MK-` transaction
 * prefixes and merchant-reference prefixes are all values that legitimate
 * uploaded data could share, so they are never used as delete criteria.
 * Children (discrepancies, events) are deleted before their parents.
 */
export async function clearDemoData(
  datasetId: string = DEMO_DATASET_ID,
): Promise<{ transactions: number; settlements: number }> {
  const [{ data: txns, error: txnError }, { data: settlements, error: settlementError }] =
    await Promise.all([
      supabaseAdmin.from("transactions").select("id").eq("dataset_id", datasetId),
      supabaseAdmin.from("settlement_records").select("id").eq("dataset_id", datasetId),
    ]);
  if (txnError) throw new Error(txnError.message);
  if (settlementError) throw new Error(settlementError.message);

  for (const table of ["discrepancies", "reconciliation_events"] as const) {
    const { error } = await supabaseAdmin.from(table).delete().eq("dataset_id", datasetId);
    if (error) throw new Error(error.message);
  }
  for (const table of ["settlement_records", "transactions", "ingestion_runs"] as const) {
    const { error } = await supabaseAdmin.from(table).delete().eq("dataset_id", datasetId);
    if (error) throw new Error(error.message);
  }

  return { transactions: (txns ?? []).length, settlements: (settlements ?? []).length };
}
