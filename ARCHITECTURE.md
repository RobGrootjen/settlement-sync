# Architecture

## Design principle: pure core, thin edges

All reconciliation rules live in **pure, dependency-free TypeScript modules** (`money`, `dates`,
`matcher`, `discrepancies`, `status`, `plan`, `trace`, `processors/*`). They take data in and return
data out — no database, no network, no clock. Everything else is a thin edge that only does I/O:

- `*.server.ts` — persistence and queries (Supabase/PostgreSQL).
- `api.functions.ts` — TanStack server functions; each handler is a one-line delegation.
- `routes/api/public/*` — four HTTP entry points for machine callers: `POST ingest`, and read-only
  `GET report`, `GET discrepancies`, `GET trace`.
- `scripts/reconcile-cli.ts` — command-line entry point.
- `routes/index.tsx` — presentation only; it never re-derives an outcome.

The same core therefore serves the UI, the HTTP endpoints and the CLI identically, and the business
rules are unit-testable without a database.

## End-to-end data flow

```text
transaction / settlement file
      -> processor adapter (NusaPay CSV | SiamLink JSON | MekongPay pipe-delimited)
      -> normalization + per-row validation (canonical shape, integer minor units, ISO dates)
      -> PostgreSQL (transactions, settlement_records, ingestion_runs)
      -> reconciliation: load working set -> match -> classify -> plan diff
      -> apply diff (discrepancies upserted by fingerprint, reconciliation_events appended)
      -> reports (positions, discrepancy queue) and per-transaction trace
```

Rejected rows are never silently dropped: they are recorded per row on the `ingestion_runs` entry.
Each raw source row is retained in `raw_payload` for audit.

## Matching and refusal to guess

Tiers run in order; the first tier producing **exactly one** candidate wins:

| Tier | Criteria | Confidence |
| --- | --- | --- |
| 1 | processor + exact processor transaction id | 1.00 |
| 2 | processor + exact merchant reference | 0.95 |
| 3 | processor + currency + exact gross + settlement date inside the window (+1 day grace), unique | 0.75 |

More than one candidate at the winning tier → the settlement is left **AMBIGUOUS** and a finding is
raised for a human; the engine never picks a "best guess". No candidate at any tier → **ORPHANED**.
Only `CAPTURED` transactions are matchable, and a transaction can be claimed once per run.

## Money and processor adapters

All amounts are **integer minor units** end to end — no floating point anywhere. Currency scale is
explicit (IDR/VND 0 decimals, THB 2), so SiamLink's major-unit decimal strings are scaled at parse
time. Each processor has its own adapter behind one interface (`parse(content, filename)`), so the
three genuinely different formats stay isolated; adding a fourth processor means adding one adapter
and one registry entry, with no change to matching, status or reporting.

## Idempotency, determinism and dataset isolation

Reconciliation is **plan-then-apply**: `plan.ts` diffs current persisted state against target state,
and only the diff is written. Already-matched settlements are not re-matched unless `rematchAll` is
set; match/status writes are skipped when unchanged; discrepancies are keyed by a stable
`fingerprint` and upserted rather than deleted/recreated; events are appended only for real changes.
A second run on unchanged data writes nothing and emits zero events.

The demo dataset is a **committed snapshot** (`sample-data/*`) ingested verbatim through the real
adapters and reconciled at a frozen `asOf` clock, so it produces identical rows on any calendar day.
Every demo row carries `dataset_id = 'deterministic-challenge-v1'`; cleanup deletes on that marker
alone and the demo's reconciliation pass is scoped to it, so user-uploaded data can never be
matched, mutated or deleted by loading the demo. (Surrogate UUIDs are regenerated on reset; business
keys and fingerprints are the stable identity.)

## Scaling beyond the challenge (not implemented here)

The current engine loads a working set into memory, which is right for this volume. At production
scale the same boundaries allow, without rewriting the core:

- **Batching** ingestion and reconciliation by processor × settlement date window.
- **Set-based SQL matching** for tiers 1–2 on indexed columns, keeping only ambiguous tier-3
  candidates in application code.
- **Queues and workers** so ingestion, matching and reporting scale independently and retry safely.
- **Object storage** for raw files, with the database holding normalized rows plus a file pointer.
- **Partitioning** of `settlement_records` / `reconciliation_events` by month, plus metrics, tracing
  and alerting on discrepancy rates and ingestion failures.

## Tradeoffs and out of scope

Deliberate tradeoffs: strict determinism over cleverness (ambiguity is escalated, never guessed);
in-memory matching for clarity over premature SQL optimisation; a minimal console because the value
here is backend correctness. Out of scope: **FX conversion** (settlement currency is assumed equal
to capture currency) and **authentication/multi-tenancy** (the challenge specifies none; the public
ingest route documents the HMAC verification production would require). Also excluded: partial and
split settlements, chargebacks/refunds, payouts and ledger postings, notifications and scheduling.
