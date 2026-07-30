import { snapshotFiles, DEMO_DATASET_ID } from "@/lib/recon/dataset/snapshot";
console.log(DEMO_DATASET_ID, snapshotFiles().map(f=>[f.filename,f.content.length]));
