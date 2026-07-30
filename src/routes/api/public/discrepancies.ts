import { createFileRoute } from "@tanstack/react-router";

/**
 * Public read-only discrepancy query.
 *
 * SECURITY NOTE: this challenge specifies no authentication, so the endpoint is
 * intentionally open and strictly read-only.
 *
 * GET /api/public/discrepancies?type=&severity=&currency=&status=&processor=&from=&to=&limit=
 */
const JSON_HEADERS = { "Content-Type": "application/json" };

const TYPES = ["MISSING", "AMOUNT_VARIANCE", "FEE_VARIANCE", "ORPHANED", "AMBIGUOUS"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH"];
const STATUSES = ["OPEN", "RESOLVED", "IGNORED"];
const PROCESSORS = ["NUSAPAY", "SIAMLINK", "MEKONGPAY"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

const bad = (error: string) => new Response(JSON.stringify({ error }), { status: 400, headers: JSON_HEADERS });

export const Route = createFileRoute("/api/public/discrepancies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const pick = (name: string) => url.searchParams.get(name)?.trim().toUpperCase() || undefined;
          const type = pick("type");
          const severity = pick("severity");
          const status = pick("status");
          const processor = pick("processor");
          const currency = pick("currency");
          const dateFrom = url.searchParams.get("from")?.trim() || undefined;
          const dateTo = url.searchParams.get("to")?.trim() || undefined;
          const limitRaw = url.searchParams.get("limit");

          if (type && !TYPES.includes(type)) return bad(`unknown type (expected one of ${TYPES.join(", ")})`);
          if (severity && !SEVERITIES.includes(severity)) return bad("unknown severity");
          if (status && !STATUSES.includes(status)) return bad("unknown status");
          if (processor && !PROCESSORS.includes(processor)) return bad("unknown processor");
          if (dateFrom && !ISO_DATE.test(dateFrom)) return bad("from must be an ISO date");
          if (dateTo && !ISO_DATE.test(dateTo)) return bad("to must be an ISO date");

          let limit: number | undefined;
          if (limitRaw !== null) {
            limit = Number(limitRaw);
            if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
              return bad("limit must be an integer between 1 and 1000");
            }
          }

          const { listDiscrepancies } = await import("@/lib/recon/reports.server");
          const rows = await listDiscrepancies({
            type,
            severity,
            status,
            processor,
            currency,
            dateFrom,
            dateTo,
            limit,
          });
          return new Response(JSON.stringify({ count: rows.length, discrepancies: rows }), {
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
