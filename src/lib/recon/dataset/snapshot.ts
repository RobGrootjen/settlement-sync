/**
 * The committed, frozen challenge dataset.
 *
 * The demo loader ingests these exact bytes from /sample-data — it never
 * regenerates dates relative to "today". Combined with DEMO_AS_OF (the fixed
 * reconciliation clock), loading the demo on any calendar day produces
 * identical rows, dates, IDs, matches, statuses and discrepancies.
 */
import transactionsCsv from "../../../../sample-data/transactions.csv?raw";
import nusapayCsv from "../../../../sample-data/nusapay-settlements.csv?raw";
import siamlinkJson from "../../../../sample-data/siamlink-settlements.json?raw";
import mekongpayTxt from "../../../../sample-data/mekongpay-settlements.txt?raw";
import { DATASET_FILENAMES, SNAPSHOT_ANCHOR } from "./generate";

/** Marker written to every demo-created row; cleanup deletes on this alone. */
export const DEMO_DATASET_ID = "deterministic-challenge-v1";

/**
 * Fixed reconciliation clock for the demo. End of the snapshot anchor day, so
 * overdue/pending classification matches the committed files exactly.
 */
export const DEMO_AS_OF = `${SNAPSHOT_ANCHOR}T23:00:00.000Z`;

export interface DemoFile {
  processor: string;
  filename: string;
  content: string;
}

/** Files in ingestion order: captures first, then each processor settlement file. */
export function snapshotFiles(): DemoFile[] {
  return [
    { processor: "CAPTURES", filename: DATASET_FILENAMES.transactions, content: transactionsCsv },
    { processor: "NUSAPAY", filename: DATASET_FILENAMES.nusapay, content: nusapayCsv },
    { processor: "SIAMLINK", filename: DATASET_FILENAMES.siamlink, content: siamlinkJson },
    { processor: "MEKONGPAY", filename: DATASET_FILENAMES.mekongpay, content: mekongpayTxt },
  ];
}
