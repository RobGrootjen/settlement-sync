# MoonCart Settlement Reconciliation Service

Backend-first reconciliation service for a multi-processor, multi-currency payments business.

## Problem

MoonCart captures payments through three payment processors (**NusaPay / IDR**, **SiamLink / THB**,
**MekongPay / VND**). Each processor sends settlement files in a different format, on its own
schedule. Money is only "real" once it settles, so the business needs to know, per transaction:
did it settle, did it settle for the right amount, was the right fee charged, is it late, and are
there settlements that belong to nothing at all.

## What the service does

1. **Ingests** processor settlement files (three genuinely different formats) and MoonCart capture
   files through per-processor adapters, with per-row validation and rejection reporting.
2. **Normalizes** everything into one canonical shape with integer minor-unit money.
3. **Matches** settlements to captured transactions with a deterministic, confidence-ranked,
   4-tier algorithm that refuses to guess.
4. **Classifies** every transaction: `NOT_DUE`, `PENDING`, `SETTLED`, `OVERDUE`, `VARIANCE`.
5. **Raises discrepancies**: missing, amount variance, fee variance, orphaned, ambiguous.
6. **Reports and traces**: positions by processor/currency, filterable discrepancy queue,
   per-transaction investigation with a full audit trail.
7. Runs **idempotently**: re-running reconciliation on unchanged data changes nothing.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime / framework | TanStack Start v1 (React 19, Vite 7), server functions for backend logic |
| Language | TypeScript (strict) |
| Database | Supabase PostgreSQL (managed via Lovable Cloud) |
| Backend logic | TanStack **Server Functions** (`createServerFn`) — the platform equivalent of Edge Functions here; plus one raw HTTP route for machine ingestion |
| UI | React + Tailwind CSS v4 (deliberately minimal ops console) |
| Tests | Vitest |

> Note on the brief: the challenge asked for Supabase Edge Functions. This runtime executes backend
> logic as TanStack server functions instead. The contracts, module boundaries and logic are
> identical; only the invocation transport differs. No logic lives in the browser.

## Quick start

```sh
npm install         # or bun install
npm run dev         # http://localhost:8080
```

### Environment variables

Provisioned automatically by Lovable Cloud into `.env`:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Database/API URL (browser + server) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable anon key |
| `VITE_SUPABASE_PROJECT_ID` | Project reference |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used by `src/integrations/supabase/client.server.ts` |

Never import the server client from browser code; it is confined to `*.server.ts` modules.

### Database / migrations

Schema is applied through Supabase migrations (tables, grants, RLS, indexes, seeded
`processor_fee_rules`). On a fresh clone with a fresh database, apply the migrations in
`supabase/migrations/` in order; on Lovable Cloud they are already applied.

### Commands

```sh
npm run dev        # dev server
bun run cli -- --help   # command-line interface
bunx vitest run    # full test suite
bunx tsgo          # TypeScript typecheck (or: npx tsc --noEmit)
npm run build      # production build
npm run lint       # eslint
```

## Using the app

Open `/` — the Settlement Reconciliation Console.

1. **Load demo dataset** — clears only demo-marked rows, ingests the four committed
   `sample-data/` files through the *real* adapters, then reconciles at a fixed `asOf` clock.
   Safe and deterministic to re-run.
2. **Ingest** — pick a processor (or "Captured transactions"), give a filename, paste the raw file
   body, press *Ingest file*. Rejected rows are reported per row with a reason.
3. **Run reconciliation** — matches unmatched settlements, sweeps transaction statuses, and
   reconciles discrepancies across all (non-demo-scoped) data.
4. **Investigate** — *Transaction investigation*: search a transaction ID (or merchant reference)
   to see the capture, matched settlement, match method/confidence, discrepancies and event history,
   plus a plain-language explanation of the outcome.
5. **Resolve** — mark a discrepancy `RESOLVED` from the discrepancy list; resolutions survive
   subsequent reconciliation runs.

## Architecture and separation of concerns

```
src/
  lib/recon/
    types.ts               domain types and enums (single source of truth)
    money.ts               minor-unit parsing, currency scale, expected-fee math
    dates.ts               settlement windows, expected settlement date, match window, date parsing
    processors/
      adapter.ts           adapter contract + shared row validation + CSV helper
      nusapay.ts           NusaPay CSV adapter (IDR)
      siamlink.ts          SiamLink JSON adapter (THB)
      mekongpay.ts         MekongPay pipe-delimited adapter (VND)
      index.ts             adapter registry
    captures.ts            MoonCart capture file parsing (CSV/JSON)
    matcher.ts             pure 4-tier matching algorithm
    discrepancies.ts       pure variance/fee evaluation + severity
    status.ts              pure transaction status state machine
    plan.ts                pure reconciliation planner (current state -> diff)
    trace.ts               pure trace explanation ("why did this happen")
    dataset/               deterministic dataset generator + frozen snapshot + fee rules
    ingest.server.ts       persistence for ingestion (idempotent upserts, run audit)
    reconcile.server.ts    loads state, calls the planner, applies only the diff
    reports.server.ts      aggregation, discrepancy queries, manual resolution
    trace.server.ts        per-transaction investigation query
    demo.server.ts         marker-scoped demo cleanup
    api.functions.ts       thin server-function API surface
  routes/
    index.tsx              ops console (presentation only)
    api/public/ingest.ts   raw HTTP POST ingestion endpoint
sample-data/               the committed deterministic challenge files
```

Rules that hold throughout:

- **Pure core, thin edges.** All business rules (`matcher`, `plan`, `status`, `discrepancies`,
  `money`, `dates`, `trace`) are pure and unit-testable with no database.
- `*.server.ts` modules do I/O only; `api.functions.ts` handlers are one-liners that delegate.
- The UI never re-derives reconciliation outcomes; it renders persisted results.

## Data model

| Table | Purpose | Key fields |
| --- | --- | --- |
| `transactions` | Original MoonCart captures | `transaction_id` (unique business key), `merchant_reference`, `processor`, `payment_method`, `status` (AUTHORIZED/CAPTURED/CANCELLED), `currency`, `captured_amount_minor`, `capture_date`, `expected_settlement_date`, `reconciliation_status` |
| `settlement_records` | Normalized processor settlement rows | `processor`, `batch_id`, `processor_transaction_id`, `merchant_reference`, `currency`, `gross_amount_minor`, `fee_amount_minor`, `net_amount_minor`, `settlement_date`, `matched_transaction_id`, `match_method`, `match_confidence`, `source_filename`, `raw_payload` |
| `discrepancies` | Findings | `discrepancy_type`, `severity`, `currency`, `expected_amount_minor`, `actual_amount_minor`, `variance_amount_minor`, `reason`, `resolution_status` (OPEN/RESOLVED/IGNORED), `resolved_at`, `fingerprint` (stable natural key, unique) |
| `reconciliation_events` | Append-only audit trail | `event_type`, `match_method`, `transaction_id`, `settlement_record_id`, `details` (JSON) |
| `ingestion_runs` | One row per uploaded file | `processor`, `filename`, `record_count`, `accepted_count`, `rejected_count`, `errors` |
| `processor_fee_rules` | Contracted fees | `processor`, `payment_method`, `currency`, `fee_bps`, `fixed_fee_minor`, `tolerance_minor` |

**Demo scoping.** Every table above (except `processor_fee_rules`) carries a nullable
`dataset_id`. Demo rows are written with `dataset_id = 'deterministic-challenge-v1'`. Demo cleanup
deletes **only** on that exact marker — never on filenames or ID prefixes — so user-uploaded data
with colliding names or `NP-`/`SL-`/`MK-`-style identifiers can never be destroyed. The demo load
also reconciles *scoped to that dataset*, so it cannot mutate user rows.

## Processor adapters and file formats

**NusaPay — CSV (IDR, 0 decimals)** `sample-data/nusapay-settlements.csv`

```
batch_id,txn_ref,merchant_ref,currency,gross,fee,net,settled_on
DMO-NU-BATCH-20260705,DMO-NU-0001,DMO-MC-0001,IDR,35936014,1242144,34693870,2026-07-05
```

**SiamLink — JSON (THB, 2 decimals, major-unit decimal strings)** `sample-data/siamlink-settlements.json`

```json
{ "batch": { "id": "DMO-SI-BATCH-20260715", "settled_at": "2026-07-15" },
  "items": [ { "reference": "DMO-SI-0002", "order_id": "DMO-MC-0002",
               "currency": "THB", "amount": "655.82", "fee": "21.04", "net": "634.78" } ] }
```

**MekongPay — pipe-delimited TXT (VND, 0 decimals, `YYYYMMDD` dates, header + detail records)**
`sample-data/mekongpay-settlements.txt`

```
H|DMO-ME-BATCH-20260721|20260721
D|DMO-ME-0003|DMO-MC-0003|VND|15307373|14845152|20260721
```

**MoonCart transactions — CSV** `sample-data/transactions.csv`

```
transaction_id,merchant_reference,processor,payment_method,status,currency,captured_amount_minor,capture_date
DMO-NU-0001,DMO-MC-0001,NUSAPAY,credit_card,CAPTURED,IDR,35936014,2026-07-02T09:00:00.000Z
```

A JSON array with the same field names is also accepted for captures.

## Normalization and money

- All money is stored as **integer minor units**. No floats, ever, anywhere in the pipeline.
- Currency scale is explicit: IDR and VND have 0 decimals, THB has 2. Adapters that emit
  major-unit decimal strings (SiamLink) are scaled on parse; adapters that emit minor units are not.
- Dates from `YYYYMMDD`, `DD/MM/YYYY` and ISO forms are parsed into ISO UTC.
- Every parsed row passes one shared validator: known currency, safe integers, positive gross,
  non-negative fee, `net === gross - fee`, valid settlement date, and enough identity
  (IDs *or* amount + date) to be matchable. Failures become per-row rejections on the ingestion run,
  never silent drops.
- Each raw row is retained in `raw_payload` for auditability.

## Matching algorithm

Tiers are tried in order; the first tier that produces exactly one candidate wins.

| Tier | Criteria | Confidence |
| --- | --- | --- |
| 1 | processor + exact `processor_transaction_id` = `transaction_id` | `1.00` (`EXACT_TXN_ID`) |
| 2 | processor + exact `merchant_reference` | `0.95` (`EXACT_MERCHANT_REF`) |
| 3 | processor + currency + exact gross amount, settlement date inside the capture's settlement window (+1 day grace), **unique** | `0.75` (`AMOUNT_DATE_WINDOW`) |
| — | more than one candidate at the winning tier | **AMBIGUOUS** — never auto-matched, discrepancy raised |
| — | no candidate at any tier | **ORPHANED** — discrepancy raised |

Only `CAPTURED` transactions are matchable, and a transaction can be claimed by only one settlement
within a run.

## Settlement windows and status rules

| Payment method | Window |
| --- | --- |
| `credit_card` | capture + 3 days |
| `bank_transfer` | capture + 7 days |
| `e_wallet` | capture + 2 days |

| Status | Rule |
| --- | --- |
| `NOT_DUE` | Transaction is `AUTHORIZED` or `CANCELLED` — nothing is owed |
| `PENDING` | `CAPTURED`, unsettled, `asOf` <= expected settlement date |
| `OVERDUE` | `CAPTURED`, unsettled, `asOf` > expected settlement date → `MISSING` discrepancy |
| `SETTLED` | Matched, gross equals captured amount, fee within contract tolerance |
| `VARIANCE` | Matched, but amount and/or fee differ |

## Discrepancy types

| Type | Meaning | Severity |
| --- | --- | --- |
| `MISSING` | Captured, overdue, never settled | by age/amount |
| `AMOUNT_VARIANCE` | Settled gross ≠ captured amount | by variance ratio (≤1% LOW, ≤5% MEDIUM, else HIGH) |
| `FEE_VARIANCE` | Actual fee ≠ contracted `fee_bps`/`fixed_fee_minor` beyond tolerance | by variance ratio |
| `ORPHANED` | Settlement with no matching transaction | HIGH |
| `AMBIGUOUS` | Settlement matched multiple candidates; matcher refused to guess | HIGH |

## Idempotency and determinism

- Reconciliation is **plan-then-apply**. `plan.ts` compares current persisted state to the target
  state and emits a diff; `reconcile.server.ts` writes only that diff.
- Already-matched settlements are **not** re-matched unless `rematchAll: true`; their variances are
  re-evaluated against the existing transaction.
- Match and status writes are skipped when values are unchanged.
- Discrepancies are keyed by a stable `fingerprint` (`TYPE:transactionId:settlementId`) and upserted;
  identical findings are never deleted and recreated. `RESOLVED`/`IGNORED` findings survive unless
  the underlying numbers materially change.
- `reconciliation_events` are appended only when something actually changed. **A second run on
  unchanged data inserts zero events.**
- Ingestion deduplicates settlement rows via a `NULLS NOT DISTINCT` unique index.
- The demo dataset is a **committed snapshot** read verbatim from `sample-data/`, reconciled with a
  frozen `asOf` clock (`DEMO_AS_OF`). Loading it today or a year from now yields identical rows,
  dates, IDs, matches, statuses and discrepancies. Database surrogate UUIDs *are* regenerated on
  each reset (rows are deleted and re-inserted); all business identifiers and fingerprints are stable.

## Deterministic demo totals

| Metric | Value |
| --- | --- |
| Transactions | 300 |
| Settlement records | 66 |
| Matched settlements | 62 |
| Missing (overdue) | 4 |
| Amount variances | 3 |
| Fee variances | 2 |
| Orphaned settlements | 3 |
| Ambiguous settlements | 1 |
| Tier-3 fallback matches | 2 |
| **Total open discrepancies** | **13** |

Transactions span a 30-day period across all three processors, all three currencies, all three
payment methods, and AUTHORIZED / CAPTURED / CANCELLED statuses, with realistic non-round amounts.

## Querying, filtering and tracing

- **Dashboard**: totals (transactions, settlements, matched, open discrepancies), position by
  processor × currency (captured, settled gross, fees, net), transaction status counts, and the
  **monetary exposure of OPEN findings** broken down by currency, type and processor. Exposure uses
  `abs(expected)` for `MISSING`, `abs(variance)` for amount/fee variances, and `abs(actual)` for
  orphaned/ambiguous settlements.
- **Discrepancy queries**: filter by `type`, `severity`, `currency`, `resolution_status`,
  `processor` (matched against the related transaction *or* settlement) and an inclusive
  `dateFrom`/`dateTo` range on `created_at`, plus `limit`. Results are joined with the full
  transaction and settlement investigation fields, newest first, severity ordered. The same filters
  are available in the console, over HTTP, and in the CLI.
- **Ingestion audit**: every file upload with record/accepted/rejected counts.
- **Transaction trace**: exact `transaction_id` lookup, falling back to `merchant_reference`.
  Returns the transaction, its matched settlements (with match method and confidence), all related
  discrepancies with resolution state, the chronological event history, and a generated explanation
  of why the transaction is settled / pending / overdue / variance / ambiguous. Not-found,
  no-settlement and no-event states are reported explicitly.

## Manual resolution workflow

An operator reviews the discrepancy queue, opens the transaction trace to see the evidence, then
marks the finding `RESOLVED` (or `IGNORED`). The resolution is timestamped, written to
`reconciliation_events`, and preserved by later reconciliation runs unless the underlying amounts or
reason materially change — in which case the finding is re-opened as a genuinely new fact.

## Architecture

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for design decisions, end-to-end data flow, and the
scalability approach. A short scripted walkthrough lives in **[DEMO.md](./DEMO.md)**.

## Interfaces

The service exposes exactly three interfaces. There is **no general REST API** — only the single
public HTTP ingestion route below.

### 1. Internal TanStack server functions

RPC-style server functions in `src/lib/recon/api.functions.ts`, called from the UI via
`useServerFn`. They are not a public REST surface: they are invoked over TanStack Start's
server-function transport, not at stable REST paths.

| Function | Method | Input | Returns |
| --- | --- | --- | --- |
| `ingestSettlements` | POST | `{ processor, filename, content }` | ingestion run summary + row rejections |
| `ingestCaptures` | POST | `{ filename, content }` | ingestion run summary + row rejections |
| `reconcile` | POST | `{ rematchAll?: boolean, asOf?: string }` | run summary (matched, ambiguous, orphaned, status changes, events) |
| `getReport` | GET | — | totals, per processor×currency buckets, status counts, discrepancy counts |
| `getDiscrepancies` | GET | `{ type?, severity?, currency?, status? }` | discrepancy rows joined with transaction + settlement |
| `getIngestionRuns` | GET | — | recent ingestion runs |
| `getEvents` | GET | — | recent reconciliation events |
| `traceTransaction` | GET | `{ query }` | `{ found, matchedBy, transaction, settlements, discrepancies, events, explanation }` |
| `resolveFinding` | POST | `{ id, status: "RESOLVED" \| "IGNORED", note? }` | `{ ok: true }` |
| `loadDemoData` | POST | — | `{ cleared, expected, runs, summary }` |

### 2. HTTP endpoints

Four public routes: one write (ingestion) and three read-only queries. There is no other REST
surface.

**Ingestion** — for processors / schedulers pushing files:

```
POST /api/public/ingest
{ "processor": "NUSAPAY" | "SIAMLINK" | "MEKONGPAY" | "CAPTURES",
  "filename": "nusapay-settlements.csv",
  "content": "<raw file body>",
  "reconcile": true }
```

```sh
curl -s -X POST "$BASE/api/public/ingest" \
  -H 'Content-Type: application/json' \
  -d '{"processor":"NUSAPAY","filename":"nusapay-settlements.csv","content":"<raw file body>","reconcile":true}'
```

**Read-only queries**

```sh
# Full reconciliation report (totals, buckets, status counts, open-discrepancy exposure)
curl -s "$BASE/api/public/report"

# Filtered discrepancies (all filters optional and combinable)
curl -s "$BASE/api/public/discrepancies?type=MISSING&processor=NUSAPAY&status=OPEN"
curl -s "$BASE/api/public/discrepancies?currency=VND&severity=HIGH&limit=10"
curl -s "$BASE/api/public/discrepancies?from=2026-07-01&to=2026-07-31"

# Transaction investigation
curl -s "$BASE/api/public/trace?query=DMO-ME-0003"
```

| Route | Filters / params | Statuses |
| --- | --- | --- |
| `GET /api/public/report` | — | `200`, `500` |
| `GET /api/public/discrepancies` | `type`, `severity`, `currency`, `status`, `processor`, `from`, `to`, `limit` | `200`, `400` (invalid filter), `500` |
| `GET /api/public/trace` | `query` (transaction id or merchant reference) | `200`, `400` (missing query), `404` (not found), `500` |
| `POST /api/public/ingest` | body: `processor`, `filename`, `content`, `reconcile?` | `200`, `400` |

`processor` on the discrepancy query matches the related **transaction or settlement**, so orphaned
settlements are included. `from`/`to` are inclusive bounds on `discrepancies.created_at`.

These endpoints are intentionally unauthenticated for the challenge; in production the ingestion
route must verify a per-processor HMAC signature before accepting a payload.

### 3. Command-line interface

`scripts/reconcile-cli.ts` is a thin edge over the same service modules (no duplicated logic). It
reads files from disk, prints JSON to stdout, and exits non-zero on invalid arguments or errors.

```sh
bun run cli -- --help
bun run cli -- load-demo
bun run cli -- ingest-transactions sample-data/transactions.csv
bun run cli -- ingest-settlements NUSAPAY sample-data/nusapay-settlements.csv
bun run cli -- ingest-settlements SIAMLINK sample-data/siamlink-settlements.json
bun run cli -- ingest-settlements MEKONGPAY sample-data/mekongpay-settlements.txt
bun run cli -- reconcile --as-of 2026-07-30T23:00:00.000Z --rematch-all
bun run cli -- report
bun run cli -- discrepancies --type MISSING --processor NUSAPAY
bun run cli -- discrepancies --currency VND --severity HIGH --status OPEN --limit 10
bun run cli -- discrepancies --from 2026-07-01 --to 2026-07-31
bun run cli -- trace DMO-ME-0003
```

| Exit code | Meaning |
| --- | --- |
| `0` | success |
| `1` | runtime error, or `trace` found no transaction |
| `2` | invalid command / arguments (help is printed to stderr) |

The CLI reads database credentials from the server environment only; it never prints them.

## Tests

`bunx vitest run` — 54 tests across 7 files:

- `recon.test.ts` — money/minor-unit scaling, expected fees, date windows and parsing, all three
  adapters incl. rejection paths, every matching tier, ambiguity/orphan refusal, variance severity,
  status state machine.
- `plan`/`idempotency.test.ts` — second run makes zero match/status writes, emits zero events,
  creates no duplicate discrepancies; resolved findings survive; `rematchAll` still recomputes.
- `dataset.test.ts` — the committed dataset produces exactly 300 transactions, 66 settlements and
  the exact intentional scenario counts (4 missing, 3 amount variances, 2 fee variances,
  3 orphaned, 1 ambiguous, 2 fallback matches).
- `demo-load.test.ts` — two consecutive demo loads produce no duplicates and identical results;
  the dataset is date-independent; non-demo rows with colliding identifiers/filenames survive a
  demo reset; demo reconciliation is dataset-scoped and never touches user rows.
- `cli-args.test.ts` — pure CLI argument parsing: help, unknown commands, missing/extra arguments,
  processor validation, `--as-of` / `--rematch-all` parsing, every `discrepancies` filter flag and
  its validation errors, trace argument handling. No database.
- `exposure.test.ts` — per-type exposure rules and OPEN-only aggregation by currency/type/processor.
- `trace.test.ts` — settled trace, variance trace (amount + fee), missing/overdue trace,
  ambiguous explanation, not-found behavior.

## Assumptions and tradeoffs

- **No authentication** — specified by the challenge. The public ingestion route documents the HMAC
  verification it would require in production.
- **Settlement currency equals capture currency.** No FX conversion is performed.
- **Fee correctness is contract-driven** via `processor_fee_rules`; a missing rule means the fee is
  not asserted rather than flagged.
- **Tier 3 gets a +1 day grace** on the settlement window to absorb processor cut-off times, and
  only ever matches when exactly one candidate exists.
- **`asOf`** defaults to now for normal runs and to the frozen `DEMO_AS_OF` for the demo, so
  overdue classification is reproducible.
- Reconciliation loads working sets into memory — appropriate for challenge volumes; production
  scale would move matching into batched, indexed SQL passes.
- Surrogate UUIDs are regenerated on demo reset; business keys are the stable identity.

## Out of scope (deliberately)

FX conversion and multi-currency netting · authentication, roles and multi-tenancy · charts and
visual dashboards · payouts/ledger postings · partial and split settlements · chargebacks and
refunds · retry/backoff for processor pulls · notifications and alerting · file-drop watchers
and scheduling.
