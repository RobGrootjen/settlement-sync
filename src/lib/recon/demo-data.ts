/**
 * Demo fixtures = the deterministic challenge dataset.
 * Files are generated from a fixed seed and anchored to today's UTC date so the
 * intentional scenario counts (overdue / pending) never drift with the calendar.
 * The committed snapshot in /sample-data is the same generator run at
 * SNAPSHOT_ANCHOR.
 */
import { generateDataset, todayAnchor } from "./dataset/generate";

export { DATASET_FILENAMES, DATASET_SEED, SNAPSHOT_ANCHOR, DEMO_PREFIX, generateDataset, todayAnchor } from "./dataset/generate";

export function demoDataset(anchor: string = todayAnchor()) {
  return generateDataset(anchor);
}

/** Files in ingestion order: captures first, then each processor settlement file. */
export function demoFiles(anchor: string = todayAnchor()) {
  return demoDataset(anchor).files;
}
