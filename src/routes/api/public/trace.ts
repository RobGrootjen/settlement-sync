import { createFileRoute } from "@tanstack/react-router";

/**
 * Public read-only transaction investigation.
 * GET /api/public/trace?query=<transaction id or merchant reference>
 * 400 when query is missing, 404 when nothing matches.
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

export const Route = createFileRoute("/api/public/trace")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const query = new URL(request.url).searchParams.get("query")?.trim();
          if (!query) {
            return new Response(JSON.stringify({ error: "query is required" }), {
              status: 400,
              headers: JSON_HEADERS,
            });
          }
          const { traceTransaction } = await import("@/lib/recon/trace.server");
          const trace = await traceTransaction({ query });
          return new Response(JSON.stringify(trace), {
            status: trace.found ? 200 : 404,
            headers: JSON_HEADERS,
          });
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
