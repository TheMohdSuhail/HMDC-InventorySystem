# Phase 1: non-authoritative batch snapshots

Migration: `202610260001_batch_tracking`.

Phase 1 adds Batch, BatchBalance, QuantityLineBatch and SaleItemBatch only. Existing
writers, APIs and UI are unchanged. No prices or costs exist on new tables. There
are no checkpoint/resume tables. No existing ledger rows are changed.

## Decisions carried into later phases

- Legacy stock stays sellable with a warning and sorts last in FEFO.
- An Admin operation to assign a real batch to legacy stock is required.
- Manufacturer-to-product ownership will be added and enforced on the server.
- Expiry is valid through the printed date, using the Asia/Kolkata business date.
- Product scanning chooses FEFO; a batch label chooses that exact batch.
- These behaviors are decisions, not features implemented in Phase 1.

## Stock writer inventory before Phase 1

Searches used:

```powershell
rg -n 'product\.(create|createMany|update|updateMany|upsert)|locationBalance\.(create|createMany|update|updateMany|upsert|delete|deleteMany)|stockMovement\.(create|createMany|update|updateMany|upsert|delete|deleteMany)' src scripts tests
rg -n '\$executeRaw|\$queryRaw|INSERT INTO|UPDATE |DELETE FROM' src scripts prisma/migrations
```

| Path | Writes and callers |
| --- | --- |
| `src/lib/inventory.ts:34` | `movement()` appends StockMovement. |
| `src/lib/inventory.ts:54` | `receive()` increments central sellable stock; used by supplier receipt, sellable return, incoming adjustment, sale cancellation and quarantine release. |
| `src/lib/inventory.ts:69` | `deduct()` conditionally decrements central sellable stock; used by sale and outgoing adjustments. |
| `src/lib/inventory.ts:426` | Non-sellable return increments damaged/expired/quarantined and appends movement. |
| `src/lib/inventory.ts:470` | Damage/expiry adjustment increments destination bucket after sellable decrement. |
| `src/lib/inventory.ts:547` | Bucket disposal/release decrements its source bucket; release calls receive. |
| `src/lib/quantity.ts:224,231` | Location helper upserts and conditionally updates LocationBalance. |
| `src/lib/quantity.ts:252,267` | Central helper updates Product buckets and appends StockMovement. |
| `src/lib/quantity.ts` switch | ASSIGN central to branch; BRANCH_RETURN reverse; READY adds manufacturer stock; DISPATCH removes ready stock; RECEIVE/STOCK_IN add central; SALE/LOSS remove sellable; RETURN adds condition bucket; DAMAGED/EXPIRED/QUARANTINED transfer buckets; RELEASE moves quarantine to sellable; three DISPOSE operations remove their buckets. |
| `src/lib/product-import-service.ts:63,67,80` | Creates Products with opening stock, appends opening movements. |
| `src/components/bulk-products.tsx` | Excel import and scan-products both commit through `/api/products/bulk` and importProducts. No separate scan writer. |
| `src/app/api/data/route.ts:90,91` | Catalog creation uses zero balance defaults; parsed catalog updates exclude balances. Other stock actions call inventory.execute. |
| `src/app/api/quantity/route.ts` | Calls executeQuantity. |
| Existing integration tests | Product fixtures in inventory, bucket, quantity and import suites. Direct archive update changes active only. Operations use the writers above. |
| Existing migrations | Define aggregate columns/defaults; role migration updates User, not stock. |

No other application or script aggregate/ledger writer was found. Phase 1 tests
also create aggregate fixtures, entirely in rolled-back validation transactions.

## Identity and database constraints

Real batch identity is unique on `(productId, manufacturerId, batchNo)`.
`getOrCreateBatch` locks the Product, validates the active manufacturer and ISO
dates, and rejects existing identities with different dates. It has no application
caller yet; future server writers must call it inside their transaction and apply
their RBAC and ownership checks. Direct duplicate INSERTs are rejected by MySQL.

Every Batch has a non-null unique `identityKey`. A CHECK requires legacy batches
to use `LEGACY:<productId>`, the fixed legacy label, null manufacturer and unknown
dates. Real keys are `BATCH:<id>` and require a manufacturer and ordered dates.
This prevents a second legacy batch even though MySQL permits repeated NULLs in
the manufacturer composite unique index. New Batch foreign keys use ON UPDATE
RESTRICT because MySQL disallows CASCADE on columns referenced by this CHECK.

BatchBalance has a database CHECK requiring all four buckets >= 0. Split CHECKs
require positive quantities and processed/returned values within quantity.
The migration SQL is the source of truth for CHECKs, which Prisma does not model.
Balances use Decimal(18,3), matching the existing aggregates. CENTRAL is the
reserved central owner; other owners retain existing User IDs.

## Backfill contract

One Serializable transaction locks products and location balances, verifies source
ledgers, creates one legacy batch per product (including archived/zero-stock
products), and copies every central/location bucket. Product expiry is deliberately
not copied: it does not prove the expiry of all historical stock.

Only QuantityLine rows for SALE/DISPATCH with quantity > processed receive explicit
splits. Only SaleItem rows for COMPLETED sales with quantity > returned receive
explicit splits. Splits preserve full source quantity and already-processed count,
not only the remainder. No split row on historical records means legacy batch.
Outstanding dispatch pieces remain in transit, not central inventory.

A same-state rerun is idempotent. Existing balances/splits are never overwritten.
A stale snapshot, invalid source cap, orphan location, source ledger mismatch,
negative aggregate, or real batch causes rollback. There is no resume state.
If ordinary writers run after backfill, reconciliation may fail. This is expected:
batch data remains non-authoritative until every writer is covered. Rebuilding a
stale snapshot requires a separately reviewed procedure; this script will not hide
the drift by silently resynchronizing it.

## Validation and later live application

The migration must first pass on the `inventory_validation_` database. Tests refuse
other database names. New MySQL fixtures roll back and do not modify live data.

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run db:backfill-batches -- --validation
npm run db:check-batches -- --validation
```

For live, after the operator takes and verifies mysqldump, schedules a stock-write
maintenance window and explicitly authorizes application:

```powershell
npm run db:migrate
npm run db:backfill-batches -- --live --backup-confirmed --confirm-database=defaultdb
npm run db:check-batches
npm run db:check
```

Do not run these live commands as part of Phase 1 validation. MySQL DDL is not
transactional; a failed migration requires inspecting which CREATE statements ran
before recovery. The data backfill itself is a single atomic transaction.

Manual checks: inspect one LEGACY batch per product; verify null legacy dates,
compare all four central/branch/manufacturer buckets, inspect outstanding dispatch
and returnable sale splits, rerun backfill with no intervening changes, and confirm
unchanged counts and zero reconciliation mismatches. Existing screens continue
using the aggregate balances. FEFO, warnings, reclassification, ownership, receiving,
sales, returns, labels and dashboards remain for later phases.

## Verified on 26 October 2026

- Prisma schema validation and client generation passed.
- TypeScript (`tsc --noEmit --incremental false`) and ESLint passed.
- Unit/access suite: 48 passed, database-dependent cases skipped.
- All 30 pre-existing MySQL integration tests passed. The final batch integration
  suite passed all 5 tests, including a database-backed sum across real batches.
- New integration tests temporarily clear only the four new snapshot tables inside
  transactions that always roll back. This makes them repeatable after a snapshot
  exists, without deleting persistent source, ledger or batch records.
- Applied the migration only to `inventory_validation_20261021`. The first attempt
  failed on the first CREATE because MySQL rejects CASCADE foreign keys referenced
  by CHECK expressions. Confirmed no partial tables, marked that failed attempt
  rolled back, then applied the corrected ON UPDATE RESTRICT version successfully.
- Schema datasource-to-datamodel comparison returned an empty migration. CHECK
  enforcement was verified by actual negative-bucket/identity rejection tests.
- Ran the validation backfill twice: each reported 319 products, 27 location
  balances, 346 batch balances and no mismatches. Independent reconciliation also
  passed after the rollback tests and after regenerating the Prisma client.
- The existing local dev server held Prisma's Windows native DLL. Briefly restarted
  only this workspace's dev server, completed normal client generation, restored
  it on port 3000 and verified `/login` returned HTTP 200.
- Read-only live reconciliation still reported 9 products, 3 location balances,
  one active Admin and zero bucket mismatches. No live migration/backfill was run.

Phase 1 stops here for review. The operator's live backup and authorization remain
pending; Phase 2 has not started.

## Phase 2 entry conditions

1. The first Phase 2 migration must add `StockMovementBatch(movementId, batchId,
   quantity)` with signed `Decimal(18,3)` quantity and restrictive foreign keys.
   For each movement, its batch splits must sum exactly to the movement quantity.
   Old movements without splits are implicitly assigned to the product's legacy
   batch. No existing ledger rows may be rewritten.

2. **OPEN DESIGN QUESTION for the Phase 2 plan:** compare capturing batch number,
   manufacturing date and expiry at READY (production) time with capturing them at
   DISPATCH time. Capturing at READY makes manufacturer balances batch-aware when
   pieces enter ready stock; DISPATCH can deduct those same batches, preserving
   reconciliation by product, manufacturer, batch and bucket. Capturing only at
   DISPATCH leaves ready stock unassigned until shipment: dispatch must atomically
   account for the removal from the manufacturer's unassigned balance and identify
   the outgoing batch. Recording only a real-batch dispatch split would leave
   manufacturer batch balances inconsistent with their aggregate. The Phase 2 plan
   must settle this flow before implementing either option.

3. Disable the backfill script at final cutover. Retain the existing guards that
   refuse after real batches exist, never overwrite an existing snapshot and stop
   on mismatches. Disabling the script at cutover is a deployment requirement;
   this fix round does not add a cutover table or implement Phase 2.

4. In Phase 3, run `EXPLAIN` on the FEFO query and test an atomic 200-line operation.

The backfill CLI now requires exactly one target mode. Validation uses only
`TEST_DATABASE_URL`, with an `inventory_validation_` database name. Live requires
both `--backup-confirmed` and `--confirm-database=<name>` matching `DATABASE_URL`;
replace `defaultdb` in the example above if the confirmed live database differs.
Unknown, repeated and conflicting flags are rejected before connecting. No live
backfill is authorized by these examples.
