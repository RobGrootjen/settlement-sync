/**
 * Pure argument parsing for the reconciliation CLI.
 *
 * Kept free of I/O and of any business logic so it can be unit tested without
 * touching the filesystem or the database.
 */

export const PROCESSORS = ["NUSAPAY", "SIAMLINK", "MEKONGPAY"] as const;
export type ProcessorCode = (typeof PROCESSORS)[number];

export type CliCommand =
  | { command: "help" }
  | { command: "load-demo" }
  | { command: "ingest-transactions"; file: string }
  | { command: "ingest-settlements"; processor: ProcessorCode; file: string }
  | { command: "reconcile"; asOf?: string; rematchAll: boolean }
  | { command: "report" }
  | { command: "trace"; query: string };

export type ParseResult =
  | { ok: true; value: CliCommand }
  | { ok: false; error: string; exitCode: number };

export const HELP_TEXT = `MoonCart settlement reconciliation CLI

Usage: bun run cli -- <command> [options]

Commands:
  help, --help, -h                      Show this help
  load-demo                             Reset and load the deterministic demo dataset, then reconcile
  ingest-transactions <file>            Ingest a MoonCart capture file (CSV or JSON)
  ingest-settlements <PROCESSOR> <file> Ingest a settlement file (NUSAPAY | SIAMLINK | MEKONGPAY)
  reconcile [--as-of <ISO>] [--rematch-all]
                                        Run reconciliation over all data
  report                                Print the current reconciliation report
  trace <transaction-id-or-merchant-reference>
                                        Print the full investigation trace for one transaction

Examples:
  bun run cli -- load-demo
  bun run cli -- ingest-transactions sample-data/transactions.csv
  bun run cli -- ingest-settlements NUSAPAY sample-data/nusapay-settlements.csv
  bun run cli -- reconcile --as-of 2026-07-30T23:00:00.000Z --rematch-all
  bun run cli -- report
  bun run cli -- trace DMO-ME-0003

All output is JSON on stdout. Errors go to stderr with a non-zero exit code.`;

function fail(error: string): ParseResult {
  return { ok: false, error, exitCode: 2 };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

export function parseCli(argv: string[]): ParseResult {
  const args = argv.filter((a) => a !== "--");
  const head = args[0];

  if (!head || head === "help" || head === "--help" || head === "-h") {
    return { ok: true, value: { command: "help" } };
  }

  switch (head) {
    case "load-demo":
      if (args.length > 1) return fail(`load-demo takes no arguments (got "${args[1]}")`);
      return { ok: true, value: { command: "load-demo" } };

    case "report":
      if (args.length > 1) return fail(`report takes no arguments (got "${args[1]}")`);
      return { ok: true, value: { command: "report" } };

    case "ingest-transactions": {
      const file = args[1];
      if (!file) return fail("ingest-transactions requires a <file> argument");
      if (args.length > 2) return fail(`unexpected argument "${args[2]}"`);
      return { ok: true, value: { command: "ingest-transactions", file } };
    }

    case "ingest-settlements": {
      const processor = (args[1] ?? "").toUpperCase();
      const file = args[2];
      if (!processor) return fail("ingest-settlements requires a <processor> argument");
      if (!PROCESSORS.includes(processor as ProcessorCode)) {
        return fail(`unknown processor "${args[1]}" (expected one of ${PROCESSORS.join(", ")})`);
      }
      if (!file) return fail("ingest-settlements requires a <file> argument");
      if (args.length > 3) return fail(`unexpected argument "${args[3]}"`);
      return {
        ok: true,
        value: { command: "ingest-settlements", processor: processor as ProcessorCode, file },
      };
    }

    case "reconcile": {
      let rematchAll = false;
      let asOf: string | undefined;
      for (let i = 1; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === "--rematch-all") {
          rematchAll = true;
        } else if (arg === "--as-of") {
          const value = args[i + 1];
          if (!value) return fail("--as-of requires an ISO date value");
          if (!ISO_DATE.test(value)) return fail(`--as-of value "${value}" is not an ISO date`);
          asOf = value;
          i += 1;
        } else {
          return fail(`unknown option "${arg}" for reconcile`);
        }
      }
      return { ok: true, value: { command: "reconcile", asOf, rematchAll } };
    }

    case "trace": {
      const query = args[1];
      if (!query || !query.trim()) {
        return fail("trace requires a <transaction-id-or-merchant-reference> argument");
      }
      if (args.length > 2) return fail(`unexpected argument "${args[2]}"`);
      return { ok: true, value: { command: "trace", query: query.trim() } };
    }

    default:
      return fail(`unknown command "${head}" (run: bun run cli -- --help)`);
  }
}
