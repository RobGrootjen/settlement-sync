# Demo walkthrough (≈3 minutes)

## 1. Load the deterministic dataset

UI: open `/` → **Load demo dataset**.
CLI: `bun run cli -- load-demo`

This clears only rows marked `dataset_id = 'deterministic-challenge-v1'`, ingests the four committed
`sample-data/` files through the real processor adapters, then reconciles at a frozen clock. Safe and
identical to re-run on any day.

## 2. Expected totals

| Metric | Value |
| --- | --- |
| Transactions | **300** |
| Settlement records | **66** |
| Matched settlements | **62** |
| Missing (overdue) | 4 |
| Amount variances | 3 |
| Fee variances | 2 |
| Orphaned settlements | 3 |
| Ambiguous settlements | 1 |
| Tier-3 fallback matches | 2 |
| **Open discrepancies** | **13** |

`bun run cli -- report` prints the same numbers as JSON.

## 3. Filter the discrepancy queue

In the console, use the filter row above the list: type, processor, currency, severity, status and a
from/to date range, plus **Clear filters**. Expect 4 + 3 + 2 + 3 + 1 = 13 open findings in total.

Worked example — overdue NusaPay captures:

```sh
bun run cli -- discrepancies --type MISSING --processor NUSAPAY
curl -s "$BASE/api/public/discrepancies?type=MISSING&processor=NUSAPAY&status=OPEN"
```

Expected: `count: 2`, for transactions `DMO-NU-0061` and `DMO-NU-0064`, each with the full
transaction record attached.

The report also carries the monetary exposure of open findings, e.g. IDR 94,979,440 across 4
findings, VND 43,079,268 across 5, THB 709,313 across 4 — broken down by type and processor:

```sh
bun run cli -- report        # or: curl -s "$BASE/api/public/report"
```

## 4. Trace a settled transaction — `DMO-ME-0003`

UI: **Transaction investigation** → search `DMO-ME-0003`.
CLI: `bun run cli -- trace DMO-ME-0003`

Expected: status **SETTLED**; one MekongPay (VND) settlement matched by `EXACT_TXN_ID` at confidence
`1.00`; gross equals the captured amount and the fee is inside contract tolerance; no open
discrepancies; event trail showing the match.

## 5. Trace a missing / overdue transaction — `DMO-NU-0061`

CLI: `bun run cli -- trace DMO-NU-0061`

Expected: status **OVERDUE**; no settlement records; one open **MISSING** discrepancy explaining that
the capture passed its expected settlement date with no settlement received; explanation states the
payment method's settlement window and the expected date.

## 6. Prove idempotency

Run **Run reconciliation** (or `bun run cli -- reconcile`) twice. The second run reports zero match
changes, zero status changes and zero new events, and the discrepancy count stays at 13.
