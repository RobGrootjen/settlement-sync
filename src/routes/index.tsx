import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  getDiscrepancies,
  getIngestionRuns,
  getReport,
  ingestCaptures,
  ingestSettlements,
  loadDemoData,
  reconcile,
  resolveFinding,
  traceTransaction,
} from "@/lib/recon/api.functions";
import { PROCESSOR_ADAPTERS, PROCESSOR_CODES } from "@/lib/recon/processors";
import { formatMinor } from "@/lib/recon/money";
import { MATCH_METHOD_LABEL } from "@/lib/recon/trace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MoonCart Settlement Reconciliation Console" },
      {
        name: "description",
        content:
          "Ingest processor settlement files across IDR, THB and VND, match them to captures and surface missing, variance, fee and orphaned discrepancies.",
      },
      { property: "og:title", content: "MoonCart Settlement Reconciliation Console" },
      {
        property: "og:description",
        content:
          "Multi-processor settlement ingestion, deterministic matching and discrepancy reporting for IDR, THB and VND.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Console,
});

const SEVERITY_STYLE: Record<string, string> = {
  HIGH: "bg-destructive/15 text-destructive",
  MEDIUM: "bg-chart-5/20 text-chart-1",
  LOW: "bg-muted text-muted-foreground",
};

function Console() {
  const queryClient = useQueryClient();
  const [processor, setProcessor] = useState<string>(PROCESSOR_CODES[0]);
  const [filename, setFilename] = useState("settlement.csv");
  const [content, setContent] = useState("");
  const [log, setLog] = useState<string>("");

  const emptyFilters = {
    type: "",
    processor: "",
    currency: "",
    severity: "",
    status: "",
    dateFrom: "",
    dateTo: "",
  };
  const [filters, setFilters] = useState(emptyFilters);
  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ""));

  const report = useQuery({ queryKey: ["report"], queryFn: () => getReport() });
  const findings = useQuery({
    queryKey: ["discrepancies", activeFilters],
    queryFn: () => getDiscrepancies({ data: activeFilters }),
  });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => getIngestionRuns() });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["report"] });
    queryClient.invalidateQueries({ queryKey: ["discrepancies"] });
    queryClient.invalidateQueries({ queryKey: ["runs"] });
  };

  const ingestFn = useServerFn(ingestSettlements);
  const captureFn = useServerFn(ingestCaptures);
  const reconcileFn = useServerFn(reconcile);
  const demoFn = useServerFn(loadDemoData);
  const resolveFn = useServerFn(resolveFinding);

  const runAction = useMutation({
    mutationFn: async (action: "ingest" | "reconcile" | "demo") => {
      if (action === "ingest") {
        return processor === "CAPTURES"
          ? captureFn({ data: { filename, content } })
          : ingestFn({ data: { processor, filename, content } });
      }
      if (action === "reconcile") return reconcileFn({ data: { rematchAll: true } });
      return demoFn({ data: undefined });
    },
    onSuccess: (result) => {
      setLog(JSON.stringify(result, null, 2));
      refreshAll();
    },
    onError: (error: Error) => setLog(`Error: ${error.message}`),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => resolveFn({ data: { id, status: "RESOLVED" as const } }),
    onSuccess: refreshAll,
  });

  const traceFn = useServerFn(traceTransaction);
  const [traceQuery, setTraceQuery] = useState("");
  const trace = useMutation({
    mutationFn: (query: string) => traceFn({ data: { query } }),
  });

  const totals = report.data?.totals;

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">MoonCart</p>
          <h1 className="text-2xl font-semibold tracking-tight">Settlement Reconciliation Console</h1>
          <p className="text-sm text-muted-foreground">
            Backend-first demo interface. Three processor adapters, deterministic matching, integer minor-unit money.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-4">
          <Stat label="Transactions" value={totals?.transactions ?? 0} />
          <Stat label="Settlements" value={totals?.settlements ?? 0} />
          <Stat label="Matched" value={totals?.matchedSettlements ?? 0} />
          <Stat label="Open discrepancies" value={totals?.openDiscrepancies ?? 0} />
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Ingest</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-[200px_1fr]">
            <select
              value={processor}
              onChange={(e) => setProcessor(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {PROCESSOR_CODES.map((code) => (
                <option key={code} value={code}>
                  {PROCESSOR_ADAPTERS[code].label}
                </option>
              ))}
              <option value="CAPTURES">Captured transactions (JSON)</option>
            </select>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="filename"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {processor === "CAPTURES"
              ? "JSON array of transactions: transaction_id, merchant_reference, processor, payment_method, status, currency, captured_amount_minor, capture_date"
              : PROCESSOR_ADAPTERS[processor]?.format}
          </p>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            placeholder="Paste the raw file contents here"
            className="mt-3 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => runAction.mutate("ingest")}
              disabled={runAction.isPending || !content}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Ingest file
            </button>
            <button
              onClick={() => runAction.mutate("reconcile")}
              disabled={runAction.isPending}
              className="h-9 rounded-md border border-input px-4 text-sm font-medium disabled:opacity-50"
            >
              Run reconciliation
            </button>
            <button
              onClick={() => runAction.mutate("demo")}
              disabled={runAction.isPending}
              className="h-9 rounded-md border border-input px-4 text-sm font-medium disabled:opacity-50"
            >
              Load demo dataset
            </button>
          </div>
          {log && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
              {log}
            </pre>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Position by processor and currency</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2">Processor</th>
                  <th>Currency</th>
                  <th>Captured</th>
                  <th>Settled gross</th>
                  <th>Fees</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {(report.data?.buckets ?? []).map((b) => (
                  <tr key={`${b.processor}-${b.currency}`} className="border-t border-border">
                    <td className="py-2 font-medium">{b.processor}</td>
                    <td>{b.currency}</td>
                    <td className="font-mono text-xs">{formatMinor(b.captured_minor, b.currency)}</td>
                    <td className="font-mono text-xs">{formatMinor(b.settled_gross_minor, b.currency)}</td>
                    <td className="font-mono text-xs">{formatMinor(b.fee_minor, b.currency)}</td>
                    <td className="font-mono text-xs">{formatMinor(b.settled_net_minor, b.currency)}</td>
                  </tr>
                ))}
                {(report.data?.buckets ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-muted-foreground">
                      No data yet — load the demo dataset.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {Object.entries(report.data?.statusCounts ?? {}).map(([status, count]) => (
              <span key={status} className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                {status}: {count}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Transaction investigation</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Trace one transaction end to end: original capture, matched settlement, discrepancies and audit events.
            Search by transaction ID (or merchant reference).
          </p>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (traceQuery.trim()) trace.mutate(traceQuery.trim());
            }}
          >
            <input
              value={traceQuery}
              onChange={(e) => setTraceQuery(e.target.value)}
              placeholder="Transaction ID or merchant reference"
              aria-label="Transaction ID or merchant reference"
              className="h-9 min-w-[280px] flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={trace.isPending || !traceQuery.trim()}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Search
            </button>
          </form>

          {trace.isError && (
            <p className="mt-3 text-sm text-destructive">{(trace.error as Error).message}</p>
          )}

          {trace.data && !trace.data.found && (
            <p className="mt-4 text-sm text-muted-foreground">{trace.data.explanation[0]}</p>
          )}

          {trace.data?.found && trace.data.transaction && (
            <div className="mt-4 space-y-4" data-testid="trace-result">
              <div className="rounded-md border border-border p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transaction</h3>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <Field label="Transaction ID" value={trace.data.transaction.transaction_id} mono />
                  <Field label="Merchant reference" value={trace.data.transaction.merchant_reference ?? "—"} mono />
                  <Field label="Processor" value={trace.data.transaction.processor} />
                  <Field label="Payment method" value={trace.data.transaction.payment_method} />
                  <Field label="Capture status" value={trace.data.transaction.status} />
                  <Field label="Reconciliation status" value={trace.data.transaction.reconciliation_status} />
                  <Field
                    label="Captured amount"
                    value={
                      trace.data.transaction.captured_amount_minor === null
                        ? "—"
                        : formatMinor(
                            Number(trace.data.transaction.captured_amount_minor),
                            trace.data.transaction.currency,
                          )
                    }
                    mono
                  />
                  <Field label="Capture date" value={trace.data.transaction.capture_date ?? "—"} mono />
                  <Field
                    label="Expected settlement date"
                    value={trace.data.transaction.expected_settlement_date ?? "—"}
                    mono
                  />
                </dl>
              </div>

              <div className="rounded-md border border-border p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Matched settlements
                </h3>
                {trace.data.settlements.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">No settlement record is matched to this transaction.</p>
                ) : (
                  trace.data.settlements.map((s) => (
                    <dl key={s.id} className="mt-2 grid gap-x-6 gap-y-1 border-t border-border pt-2 text-sm sm:grid-cols-2">
                      <Field label="Processor txn ID" value={s.processor_transaction_id ?? "—"} mono />
                      <Field label="Batch" value={s.batch_id ?? "—"} mono />
                      <Field label="Gross" value={formatMinor(Number(s.gross_amount_minor), s.currency)} mono />
                      <Field label="Fee" value={formatMinor(Number(s.fee_amount_minor), s.currency)} mono />
                      <Field label="Net" value={formatMinor(Number(s.net_amount_minor), s.currency)} mono />
                      <Field label="Settlement date" value={s.settlement_date} mono />
                      <Field
                        label="Match method"
                        value={s.match_method ? (MATCH_METHOD_LABEL[s.match_method] ?? s.match_method) : "—"}
                      />
                      <Field
                        label="Confidence"
                        value={s.match_confidence === null ? "—" : Number(s.match_confidence).toFixed(2)}
                        mono
                      />
                      <Field label="Source file" value={s.source_filename ?? "—"} mono />
                    </dl>
                  ))
                )}
              </div>

              <div className="rounded-md border border-border p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {trace.data.explanation.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md border border-border p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Related discrepancies
                </h3>
                {trace.data.discrepancies.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">None recorded.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {trace.data.discrepancies.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                          {d.discrepancy_type}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[d.severity] ?? ""}`}>
                          {d.severity}
                        </span>
                        <span className="text-xs text-muted-foreground">{d.resolution_status}</span>
                        <span className="text-muted-foreground">{d.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-md border border-border p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event history</h3>
                {trace.data.events.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">No reconciliation events recorded yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                    {trace.data.events.map((e) => (
                      <li key={e.id}>
                        {new Date(e.created_at).toISOString()} · {e.event_type}
                        {e.match_method ? ` · ${e.match_method}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Discrepancies</h2>
          <div className="mt-3 space-y-2">
            {(findings.data ?? []).map((d) => (
              <div key={d.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-secondary px-2 py-0.5 font-medium">{d.discrepancy_type}</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${SEVERITY_STYLE[d.severity] ?? ""}`}>
                    {d.severity}
                  </span>
                  <span className="text-muted-foreground">{d.resolution_status}</span>
                  {d.variance_amount_minor !== null && d.currency && (
                    <span className="font-mono text-muted-foreground">
                      Δ {formatMinor(Number(d.variance_amount_minor), d.currency)}
                    </span>
                  )}
                  {d.resolution_status === "OPEN" && (
                    <button
                      onClick={() => resolve.mutate(d.id)}
                      className="ml-auto rounded-md border border-input px-2 py-0.5 text-xs"
                    >
                      Resolve
                    </button>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{d.reason}</p>
              </div>
            ))}
            {(findings.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No discrepancies recorded.</p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Ingestion audit</h2>
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {(runs.data ?? []).map((r) => (
              <li key={r.id} className="font-mono">
                {new Date(r.created_at).toISOString()} · {r.processor} · {r.filename} · {r.record_count} rows ·{" "}
                {r.accepted_count} accepted · {r.rejected_count} rejected
              </li>
            ))}
            {(runs.data ?? []).length === 0 && <li>No ingestion runs yet.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-sm"}>{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
