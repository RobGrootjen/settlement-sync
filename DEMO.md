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

In the console, filter by type (`MISSING`, `AMOUNT_VARIANCE`, `FEE_VARIANCE`, `ORPHANED`,
`AMBIGUOUS`), severity, currency or resolution status. Expect 4 + 3 + 2 + 3 + 1 = 13 open findings.

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
