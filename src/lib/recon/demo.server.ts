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

/**
 * Load the deterministic challenge dataset: clear previous demo rows, ingest the
 * committed sample files through the normal adapters, then reconcile scoped to
 * the demo dataset. Shared by the server-function API and the CLI.
 */
export async function loadDemoDataset() {
  const { snapshotFiles, demoExpectations, DEMO_AS_OF } = await import("./demo-data");
  const { ingestSettlementFile, ingestTransactions } = await import("./ingest.server");
  const { runReconciliation } = await import("./reconcile.server");

  const cleared = await clearDemoData(DEMO_DATASET_ID);

  const runs = [];
  for (const file of snapshotFiles()) {
    runs.push(
      file.processor === "CAPTURES"
        ? await ingestTransactions({
            filename: file.filename,
            content: file.content,
            datasetId: DEMO_DATASET_ID,
          })
        : await ingestSettlementFile({ ...file, datasetId: DEMO_DATASET_ID }),
    );
  }
  const summary = await runReconciliation({
    rematchAll: true,
    asOf: DEMO_AS_OF,
    datasetId: DEMO_DATASET_ID,
  });
  return { cleared, expected: demoExpectations(), runs, summary };
}
