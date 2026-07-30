import { createFileRoute } from "@tanstack/react-router";

/**
 * Raw HTTP ingestion endpoint for processors pushing settlement files.
 *
 * SECURITY NOTE: this challenge specifies no authentication, so the endpoint is
 * intentionally open. In production it must verify a per-processor HMAC
 * signature before accepting a payload.
 *
 * POST { processor, filename, content, reconcile? }
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

export const Route = createFileRoute("/api/public/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            processor?: string;
            filename?: string;
            content?: string;
            reconcile?: boolean;
          };
          if (!body.processor || !body.content) {
            return new Response(JSON.stringify({ error: "processor and content are required" }), {
              status: 400,
              headers: JSON_HEADERS,
            });
          }
          const { ingestSettlementFile, ingestTransactions } = await import("@/lib/recon/ingest.server");
          const filename = body.filename ?? "upload";
          const result =
            body.processor.toUpperCase() === "CAPTURES"
              ? await ingestTransactions({ filename, content: body.content })
              : await ingestSettlementFile({ processor: body.processor, filename, content: body.content });

          let reconciliation = null;
          if (body.reconcile) {
            const { runReconciliation } = await import("@/lib/recon/reconcile.server");
            reconciliation = await runReconciliation({ rematchAll: true });
          }
          return new Response(JSON.stringify({ ingestion: result, reconciliation }), { headers: JSON_HEADERS });
        } catch (e) {
          return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 400,
            headers: JSON_HEADERS,
          });
        }
      },
    },
  },
});