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
  .inputValidator((input?: { rematchAll?: boolean; asOf?: string }) => ({
    rematchAll: input?.rematchAll ?? false,
    asOf: input?.asOf,
  }))
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

/** Investigation: full audit trace for one transaction id / merchant reference. */
export const traceTransaction = createServerFn({ method: "GET" })
  .inputValidator((input: { query: string }) => {
    if (!input?.query?.trim()) throw new Error("query is required");
    return { query: input.query.trim() };
  })
  .handler(async ({ data }) => {
    const { traceTransaction: run } = await import("./trace.server");
    return run(data);
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
  // Scoped to the demo dataset so the load can never touch user-uploaded rows.
  const { loadDemoDataset } = await import("./demo.server");
  return loadDemoDataset();
});
