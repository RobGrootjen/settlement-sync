/**
 * Command-line interface for the reconciliation service.
 *
 * This is a thin edge like the server functions: it reads files from disk,
 * delegates to the existing service modules, and prints JSON. No business
 * logic lives here.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { HELP_TEXT, parseCli } from "./cli-args";

function readFile(path: string): { filename: string; content: string } {
  const full = resolve(process.cwd(), path);
  return { filename: basename(full), content: readFileSync(full, "utf8") };
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<number> {
  const parsed = parseCli(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`error: ${parsed.error}`);
    console.error("");
    console.error(HELP_TEXT);
    return parsed.exitCode;
  }

  const cmd = parsed.value;
  if (cmd.command === "help") {
    console.log(HELP_TEXT);
    return 0;
  }

  switch (cmd.command) {
    case "load-demo": {
      const { loadDemoDataset } = await import("@/lib/recon/demo.server");
      print(await loadDemoDataset());
      return 0;
    }
    case "ingest-transactions": {
      const { ingestTransactions } = await import("@/lib/recon/ingest.server");
      print(await ingestTransactions(readFile(cmd.file)));
      return 0;
    }
    case "ingest-settlements": {
      const { ingestSettlementFile } = await import("@/lib/recon/ingest.server");
      print(await ingestSettlementFile({ processor: cmd.processor, ...readFile(cmd.file) }));
      return 0;
    }
    case "reconcile": {
      const { runReconciliation } = await import("@/lib/recon/reconcile.server");
      print(await runReconciliation({ rematchAll: cmd.rematchAll, asOf: cmd.asOf }));
      return 0;
    }
    case "report": {
      const { getReconciliationReport } = await import("@/lib/recon/reports.server");
      print(await getReconciliationReport());
      return 0;
    }
    case "trace": {
      const { traceTransaction } = await import("@/lib/recon/trace.server");
      const trace = await traceTransaction({ query: cmd.query });
      print(trace);
      return trace.found ? 0 : 1;
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    // Never print raw environment/config values, only the failure message.
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
