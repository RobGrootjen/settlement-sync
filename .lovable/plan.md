## One deviation up front

This project runs on TanStack Start (React 19 + Vite) with Lovable Cloud (managed Postgres + auth + functions). Its server runtime replaces Supabase Edge Functions — server code lives in typed server functions/HTTP routes in the same repo instead of `supabase/functions/*`. Same Deno-free TypeScript, same Postgres, same auditability, but no separate deploy step and shared types with the UI. Everything you specced as an Edge Function becomes a callable endpoint with an identical contract. Database, money handling, matching rules and tables are exactly as you specified.

## 1. Files and folders

```text
supabase/migrations/
  <ts>_reconciliation_core.sql      # 5 tables, enums-as-check, indexes, FKs, grants, RLS

src/lib/recon/
  types.ts                # domain types: NormalizedSettlement, MatchResult, etc.
  money.ts                # minor-unit helpers: parseMinor(str, currency), no floats
  dates.ts                # settlement windows, date-window comparison
  processors/
    index.ts              # registry: processor code -> adapter
    processor-a.ts        # CSV-style flat rows (IDR)
    processor-b.ts        # nested JSON batch (THB)
    processor-c.ts        # pipe-delimited, fee embedded (VND)
    adapter.ts            # ProcessorAdapter interface + shared validation
  normalize.ts            # raw row -> NormalizedSettlement + reject reasons
  matcher.ts              # 4-tier matching engine (pure, testable)
  discrepancies.ts        # variance/fee/missing/orphan calculators
  status.ts               # transaction reconciliation_status rules
  reports.ts              # aggregation query builders

src/lib/recon/*.server.ts # DB-touching implementations (admin client)
src/lib/recon/api.functions.ts  # thin server-function wrappers (the "edge functions")
src/routes/api/public/ingest.ts # raw HTTP ingestion endpoint (file/JSON POST)

src/lib/recon/__tests__/     # unit tests for matcher, money, discrepancies
src/routes/index.tsx         # minimal ops console (built after backend)
```

## 2. Database schema

Exactly the five tables you listed, with:
- money columns `bigint` (minor units only), `check (amount >= 0)` where sensible
- text status columns constrained by `CHECK (... in (...))` so values are self-documenting and migratable
- FKs: `settlement_records.matched_transaction_id -> transactions(id) on delete set null`; `discrepancies.transaction_id -> transactions(id) on delete cascade`; `discrepancies.settlement_record_id -> settlement_records(id) on delete cascade`; same for `reconciliation_events`
- Indexes:
  - `transactions(transaction_id)` unique, `(processor, status)`, `(reconciliation_status)`, `(processor, currency, captured_amount_minor)` for tier-3 matching, `(merchant_reference)`, `(expected_settlement_date)`
  - `settlement_records(processor, processor_transaction_id)`, `(processor, merchant_reference)`, `(matched_transaction_id)`, `(batch_id)`, `(settlement_date)`
  - `discrepancies(discrepancy_type, resolution_status)`, `(transaction_id)`, `(settlement_record_id)`
  - `ingestion_runs(created_at desc)`, `reconciliation_events(created_at desc)`
- No auth per your spec: RLS enabled with permissive read policies for `anon`, all writes performed server-side via the service role. This keeps the demo open while preventing browser-side tampering.
- `expected_settlement_date` is written at ingest/seed time from `capture_date + window(payment_method)` where absent.

## 3. Endpoints (your "edge functions")

| Endpoint | Purpose |
|---|---|
| `ingestSettlementFile` | body: `{ processor, filename, content }` → parse via adapter, normalize, validate, insert `settlement_records`, write `ingestion_runs` row with accepted/rejected counts and per-row errors |
| `ingestTransactions` | same shape for capture-side files |
| `runReconciliation` | matches unmatched settlements, updates `matched_transaction_id/match_method/match_confidence`, recomputes transaction statuses, generates discrepancies, logs `reconciliation_events` |
| `getReconciliationSummary` | per-currency/processor totals: settled, pending, overdue, variance, orphaned, net settled minor |
| `listDiscrepancies` | filters: type, severity, currency, processor, status; paginated |
| `resolveDiscrepancy` | sets `resolution_status`, `resolved_at`, logs event |
| `getIngestionRuns` | audit list |
| `POST /api/public/ingest` | raw HTTP variant of ingestion for curl/processor pushes |

All are idempotent-safe: ingestion dedupes on `(processor, processor_transaction_id, settlement_date, gross_amount_minor)`; reconciliation only touches unmatched rows unless `force: true`.

## 4. Matching algorithm pseudocode

```text
for each settlement S in unmatched settlements (ordered by settlement_date):

  # tier 1
  C = transactions where transaction_id = S.processor_transaction_id
                     and processor    = S.processor
  if |C| == 1 -> match(S, C[0], "EXACT_TXN_ID", 1.00)

  # tier 2
  else:
    C = transactions where merchant_reference = S.merchant_reference
                       and processor = S.processor
                       and merchant_reference is not null
    if |C| == 1 -> match(S, C[0], "EXACT_MERCHANT_REF", 0.95)
    if |C| >  1 -> ambiguous(S, C)

    # tier 3
    else:
      W = window_days(candidate.payment_method)   # cc 3, bank 7, wallet 2
      C = transactions where processor = S.processor
                         and currency  = S.currency
                         and captured_amount_minor = S.gross_amount_minor
                         and status = 'CAPTURED'
                         and S.settlement_date between capture_date
                                       and capture_date + (W + grace) days
      if |C| == 1 -> match(S, C[0], "AMOUNT_DATE_WINDOW", 0.75)
      if |C| >  1 -> ambiguous(S, C)   # never guess
      if |C| == 0 -> orphan(S)

match(S,T,method,conf):
  S.matched_transaction_id, match_method, match_confidence = ...
  amount_delta = S.gross_amount_minor - T.captured_amount_minor
  fee_delta    = S.fee_amount_minor - expected_fee(T)   # from processor fee config
  if amount_delta != 0 -> discrepancy AMOUNT_VARIANCE, severity by |delta| ratio
  if fee_delta    != 0 -> discrepancy FEE_VARIANCE
  T.reconciliation_status = (any variance) ? 'VARIANCE' : 'SETTLED'
  log reconciliation_event

ambiguous(S,C): discrepancy AMBIGUOUS (HIGH), reason lists candidate ids, S stays unmatched
orphan(S):      discrepancy ORPHANED (HIGH), S stays unmatched

# transaction sweep (runs after matching)
for each transaction T:
  if T.status in (AUTHORIZED, CANCELLED)      -> NOT_DUE
  elif matched                                 -> SETTLED | VARIANCE (above)
  elif now <= expected_settlement_date         -> PENDING
  else -> OVERDUE + discrepancy MISSING (severity by amount)
```

Severity bands: variance ≤ 1% of expected → LOW, ≤ 5% → MEDIUM, else HIGH; MISSING/ORPHANED/AMBIGUOUS default HIGH (MEDIUM for small amounts).

## 5. Risks and assumptions

- **Fee expectations**: your spec asks for fee discrepancies but no source of truth for expected fees. Assumption: a small per-processor/method fee-rate config table (`processor_fee_rules`) computed as `round(gross * bps / 10000) + fixed`, banker-free integer math. If you'd rather compare fees only against a processor-declared fee in the file, say so and I'll drop the config.
- **Tier-3 date window**: window days come from the candidate transaction's `payment_method`; I add a configurable grace (default 1 day) so a T+3 file arriving late still matches. Configurable constant.
- **Currency scale**: IDR/VND are zero-decimal in practice, THB is two-decimal. Parsers must know scale per currency, otherwise VND amounts inflate 100×. Handled in `money.ts` with an explicit currency-scale table; all parsing goes through string → integer, never `parseFloat`.
- **Sample files**: I'll generate three realistic fixture files (one per processor, deliberately containing a missing settlement, an amount variance, a fee variance, an orphan and an ambiguous pair) so the demo is provable.
- **No auth** means the ingestion HTTP endpoint is open; acceptable for a timed challenge, flagged in code comments.
- **Idempotency**: re-running reconciliation should not duplicate discrepancies; I dedupe on `(transaction_id, settlement_record_id, discrepancy_type)` while `OPEN`.
- **Scale**: matching runs in batches in memory; fine to ~100k rows. Beyond that it needs SQL-side matching.

## Build order after approval

1. Migration (schema + indexes + grants + fee rules + demo seed rows)
2. Pure service layer (money, dates, adapters, matcher, discrepancies, status) + unit tests
3. Server endpoints wiring those services
4. Minimal ops console page: ingest a file, run reconciliation, view summary + discrepancy table
