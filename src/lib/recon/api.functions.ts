import { createServerFn } from "@tanstack/react-start";

/**
 * Public endpoints for the reconciliation backend. This demo has no auth by
 * design (timed challenge); every handler is thin and delegates to a service
 * module so the logic stays testable and auditable.
 */

export const ingestSettlements = createServerFn({ method: "POST" })
  .inputValidator((input: { processor: string; filename: string; content: string }) => {
    if (!input?.processor) throw new Error("processor is required");
    if (!input?.content) throw new Error("content is required");
    return { ...input, filename: input.filename || "upload" };
  })
  .handler(async ({ data }) => {
    const { ingestSettlementFile } = await import("./ingest.server");
    return ingestSettlementFile(data);
  });

export const ingestCaptures = createServerFn({ method: "POST" })
  .inputValidator((input: { filename: string; content: string }) => {
    if (!input?.content) throw new Error("content is required");
    return { ...input, filename: input.filename || "captures.json" };
  })
  .handler(async ({ data }) => {
    const { ingestTransactions } = await import("./ingest.server");
    return ingestTransactions(data);
  });

export const reconcile = createServerFn({ method: "POST" })
  .inputValidator((input?: { rematchAll?: boolean }) => ({ rematchAll: input?.rematchAll ?? false }))
  .handler(async ({ data }) => {
    const { runReconciliation } = await import("./reconcile.server");
    return runReconciliation(data);
  });

export const getReport = createServerFn({ method: "GET" }).handler(async () => {
  const { getReconciliationReport } = await import("./reports.server");
  return getReconciliationReport();
});

export const getDiscrepancies = createServerFn({ method: "GET" })
  .inputValidator((input?: { type?: string; severity?: string; currency?: string; status?: string }) => input ?? {})
  .handler(async ({ data }) => {
    const { listDiscrepancies } = await import("./reports.server");
    return listDiscrepancies(data);
  });

export const getIngestionRuns = createServerFn({ method: "GET" }).handler(async () => {
  const { listIngestionRuns } = await import("./reports.server");
  return listIngestionRuns();
});

export const getEvents = createServerFn({ method: "GET" }).handler(async () => {
  const { listEvents } = await import("./reports.server");
  return listEvents();
});

export const resolveFinding = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string; status: "RESOLVED" | "IGNORED"; note?: string }) => {
    if (!input?.id) throw new Error("id is required");
    return input;
  })
  .handler(async ({ data }) => {
    const { resolveDiscrepancy } = await import("./reports.server");
    return resolveDiscrepancy(data);
  });

/**
 * Loads the deterministic challenge dataset: clears previous demo rows, then
 * ingests the exact generated files through the normal adapters/ingestion path
 * before running a full reconciliation. Safe to re-run.
 */
export const loadDemoData = createServerFn({ method: "POST" }).handler(async () => {
  const { demoDataset } = await import("./demo-data");
  const { clearDemoData } = await import("./demo.server");
  const { ingestSettlementFile, ingestTransactions } = await import("./ingest.server");
  const { runReconciliation } = await import("./reconcile.server");

  const cleared = await clearDemoData();
  const dataset = demoDataset();

  const runs = [];
  for (const file of dataset.files) {
    runs.push(
      file.processor === "CAPTURES"
        ? await ingestTransactions({ filename: file.filename, content: file.content })
        : await ingestSettlementFile(file),
    );
  }
  const summary = await runReconciliation({ rematchAll: true });
  return { cleared, expected: dataset.expected, runs, summary };
});
