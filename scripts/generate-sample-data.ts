/** Writes the committed snapshot of the deterministic dataset to /sample-data. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateDataset, SNAPSHOT_ANCHOR } from "../src/lib/recon/dataset/generate";

const dir = join(process.cwd(), "sample-data");
mkdirSync(dir, { recursive: true });
const dataset = generateDataset(SNAPSHOT_ANCHOR);
for (const file of dataset.files) {
  writeFileSync(join(dir, file.filename), `${file.content}\n`);
}
console.log(JSON.stringify(dataset.expected, null, 2));
