# Validation log

## Bulk import and continuous scanning — 22 October 2026

- Unit/access suite: 38 passed, including CSV quoting/BOM/multiline parsing, XLSX reading, textual barcode leading zeros, row validation, duplicate detection, malformed files, formula rejection, archive decompression limits, scan counting and permissions. Database-dependent tests are skipped by the unit-only command.
- Targeted MySQL import suite: 3 passed in `inventory_validation_20261021`. Verified atomic product/opening-stock creation, idempotent concurrent retry, different-payload rejection, duplicate rollback, and a 50-product batch with long notes and per-product audit snapshots.
- Full Chrome workflow passed with real CSV upload, editable preview, successful import, duplicate re-import blocking, repeated barcode quantity accumulation, rejection/input clearing for existing catalog barcodes, opening ledger checks, regular-user import denial, and existing mobile/sales/account workflows.
- TypeScript and lint passed. Next.js production build passed using the existing generated Prisma client (`node node_modules/next/dist/bin/next build`). The `npm run build` wrapper's redundant Prisma generation encountered the documented Windows DLL lock while the user's development server was running; no schema changes were needed. The development server was preserved.
- Local `/api/products/bulk` responds with HTTP 401 without authentication. Actual data changes in tests were confined to the separate validation database. No new migration, production data import, or physical scanner/camera-device verification was performed.

## Dashboard loading fix — 21 October 2026

Reproduced missing production JavaScript/CSS assets after development output replaced `.next`. Development now uses `.next-dev`, while production keeps `.next`. Rebuilt and restarted the local production server. All 10 referenced production login-page JS/CSS assets returned HTTP 200 with the correct content types. The updated unit suite passed 24 tests, including development/production output isolation. The full Chrome workflow passed again, now also covering barcode entry plus Enter (USB-scanner behavior), registered-product lookup, and return to a loaded dashboard. Barcode input receives focus when the scanner opens. TypeScript, lint and production build passed. No application inventory records were changed by this fix; browser fixtures were created only in the separate validation database. Physical scanner/camera hardware still needs device-level verification.

## Initial implementation checks

- TypeScript: `npm run typecheck` passed.
- ESLint: `npm run lint` passed without warnings or errors.
- Unit, validation, permission, unauthorized-route, CSV and error-safety tests: 22 passed (`npm test`). The isolated MySQL cases are deliberately skipped by this command when no test URL is loaded.
- MySQL integration: 22 passed together (`npm run test:integration`), using only `inventory_validation_20261021`. Coverage includes opening stock, partial receiving, sales, quantity/refund bounds, duplicate requests, competing sales, cancellation reversals, weighted-average costs, historical reports, payments, bucket inspection/disposal, and role restrictions.
- Production build: `npm run build` passed with all application and API routes generated successfully. The barcode library loads on demand; the main route's first-load JavaScript is approximately 159 kB in this build.
- Chrome browser checks: passed admin login, protected API access, all nine navigation screens, product creation, opening stock, sales, product CSV download, user creation, 390px mobile layout without document overflow, regular-user login, forbidden admin API operations, regular-user sales, and logout. No client runtime errors were reported. Screenshots are in the ignored `artifacts` directory.
- Aiven: strict TLS with the supplied CA verified. Both additive migrations applied; `prisma migrate status` reports up to date. The main application database has one active admin and no sample products. `npm run db:check` reports no bucket/ledger mismatches.
- Build packaging: Aiven CA is included in the server file trace. Configured auth/setup/database secrets and the database hostname were absent from generated browser assets.
- Dependency audit: the live production audit reports zero advisories after compatible PostCSS and deepmerge overrides. Five development-tool advisories remain through the Next.js ESLint glob/braces dependency chain; see README for the scope and limitation.

Not verified or configured: public deployment, DNS, provider network allowlists, scheduled backups, a full backup/restore drill, physical camera/USB-scanner hardware, or real business data. See README for setup, deployment, financial definitions, permissions, and remaining limits. The database provided no existing tables or inventory to migrate.

## 23 October 2026 - Quantity-only roles, locations, manufacturing and expiry

- Replaced the active money-based workspace with quantity-only screens and exports. Historical financial tables/columns remain intact. Product prices are no longer required for new entry/import. Catalog edits preserve stored historical reference prices.
- Added ADMIN, BRANCH_MANAGER and MANUFACTURER accounts. Migrated legacy USER accounts to BRANCH_MANAGER. All inventory/report/export reads are scoped on the server. Branch managers only see assigned products/balances/history and can sell, return or record daily losses/damage/expiry/quarantine in their own location. Admin controls the catalog and allocations.
- Added atomic central-to-branch allocation and branch-to-central returns, separate location balances, linked capped sales returns with persisted condition, audited bulk quantity events, nonnegative balance guards, request fingerprints and MySQL deadlock retry handling (including raw-query error 1213).
- Manufacturing records boxes, pieces per box, loose pieces and server-verified totals. Dispatch deducts ready stock and stays in transit; only admin confirmation, including partial receipt, adds central inventory. Overdispatch and overreceipt are blocked.
- Added optional product expiry dates to add/edit, CSV/XLSX import and quantity exports. Inventory highlights past expiry dates and expiry within 30 days. Dates are product-level, not per-lot; no automatic stock movement or sale blocking is implied.
- All stock operation forms accept multiple products, keyboard scanner Enter and camera scanning. Repeat scans increment quantity. Product import remains 200 rows / 2 MB. Fixed successful import closing and added 50-product list increments.
- Typecheck, ESLint and production Next build passed. 43 unit/access tests passed; integration suites skip in default test runs.
- Legacy ledger/bucket/import integration suites passed (25 tests). The new location/manufacturing suite passed all 5 tests after retry fixes, including concurrent idempotency, whole-batch rollback, central/branch isolation, ownership enforcement, packed piece totals, transit/receipt caps and damaged branch returns.
- Applied all three additive migrations to the configured live database. Before/after product count: 9. Existing regular user converted to branch manager; no allocations or fake production inventory created. Live central/location reconciliation passed: no bucket mismatches, one active admin.
- Restarted this workspace's development server on localhost:3000 with the regenerated Prisma client. Development and production build directories remain isolated.
- Physical camera/USB/Bluetooth scanner hardware is not available for device validation. Browser tests exercise barcode text/Enter paths.

- Chrome end-to-end flow passed with all three roles: quantity-only screens, product expiry, CSV import, barcode batches, branch isolation/sale/return, manufacturer box totals/dispatch, and admin receipt. Visual review found a legacy mobile sidebar transform; reset it so mobile navigation stays on screen, and added a navigation position/click assertion.

- Final review: continuous camera scanning now keeps its pause across parent re-renders, preventing repeated reads of a held barcode until re-armed. Admin can release/dispose branch buckets; branch users remain blocked from these protected actions. Added explicit assigned-product checks before accessing branch operation product details. Targeted MySQL test passed for wrong-product returns, protected disposal, and nonnegative branch balances.
- Independent reconstruction of the isolated validation database passed: 235 products and 15 location balances, zero central or location mismatches (counts reflect test fixtures at verification time). Latest default run: 43 passed, 30 integration tests skipped as designed.

- Final production build passed with the explicit branch product ownership guard present in the built server chunk. Final Chrome rerun passed all three-role workflows and the mobile navigation position/click assertions. Screenshots: artifacts/quantity-admin-desktop.png and artifacts/quantity-branch-mobile.png.

## 23 October 2026 - Logout and Excel files

- Added visible Logout controls to header and sidebar for all roles. Logout checks the server response, revokes the current session, redirects to login and displays failures instead of falsely reporting success.
- Product template, inventory/operations/supplier/sales exports and report downloads now generate real .xlsx Open XML workbooks. Excel identifier cells are text; quantities are numeric; formula-like text is literal. No new dependencies or database migrations.
- Active product upload accepts .xlsx only. Existing file size, formula, barcode and zip expansion checks remain. UI labels and file filters now say Excel.
- Typecheck and 45 unit/access tests passed, including native XLSX parsing, template headers, quantity/identifier round trips and CSV upload rejection.

- Chrome passed all three role workflows with real XLSX template download, XLSX upload, inventory/operations/report workbook parsing, branch-scoped Excel output and authenticated API returning 401 after header Logout. Mobile layout/navigation and existing barcode workflows passed.
- Final template formatting uses Excel Text columns for identifiers and other text fields, numeric quantity columns, frozen headers and filters. Operation timestamps retain full ISO time; expiry fields use YYYY-MM-DD. XLSX reader round-trip tests passed after the formatting change.
