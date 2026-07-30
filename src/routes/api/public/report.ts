import { createFileRoute } from "@tanstack/react-router";

/** Public read-only reconciliation report. GET /api/public/report */
const JSON_HEADERS = { "Content-Type": "application/json" };

export const Route = createFileRoute("/api/public/report")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getReconciliationReport } = await import("@/lib/recon/reports.server");
          return new Response(JSON.stringify(await getReconciliationReport()), { headers: JSON_HEADERS });
        } catch (e) {
          return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500,
            headers: JSON_HEADERS,
          });
        }
      },
    },
  },
});
