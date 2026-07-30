/**
 * Demo fixtures = the committed deterministic challenge dataset.
 * The loader reads the frozen files in /sample-data verbatim and reconciles
 * them against DEMO_AS_OF, so results never drift with the calendar.
 */
export {
  DATASET_FILENAMES,
  DATASET_SEED,
  SNAPSHOT_ANCHOR,
  DEMO_PREFIX,
  generateDataset,
} from "./dataset/generate";
export { DEMO_DATASET_ID, DEMO_AS_OF, snapshotFiles, type DemoFile } from "./dataset/snapshot";

import { snapshotFiles } from "./dataset/snapshot";
import { generateDataset, SNAPSHOT_ANCHOR } from "./dataset/generate";

/** Expected totals for the frozen dataset (derived from the same generator). */
export function demoExpectations() {
  return generateDataset(SNAPSHOT_ANCHOR).expected;
}

export function demoFiles() {
  return snapshotFiles();
}
