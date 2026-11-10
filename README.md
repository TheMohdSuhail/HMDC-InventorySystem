# Herbal Maza Inventory

A Next.js App Router / TypeScript / Tailwind application backed exclusively by MySQL and Prisma. All screens use the authenticated database API. There are no seeded products or sample statistics in the application database.

## Current workspace

The original workspace was empty. Aiven `defaultdb` was inspected over verified TLS and was empty before the additive initial migration was applied. The application schema and the role/location/expiry migrations are applied after validation. The separate `inventory_validation_20261021` database contains test fixtures only. It is never used by the application unless explicitly selected through the test commands.

The initial admin is the email configured in the local `.env` under `SETUP_EMAIL`. Its cryptographically generated initial password is in the same **git-ignored** file under `SETUP_PASSWORD`. Copy that password privately, sign in, change it in **Settings → Change your password**, then remove `SETUP_PASSWORD` from `.env`. Never deploy the setup password or commit `.env`, certificates, or backups. No public registration exists.

## Run locally

Use Node.js 22 LTS or 24 LTS, npm, and MySQL 8+. Dependencies are pinned by `package-lock.json`.

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Open http://localhost:3000. For the production server:

Development output uses `.next-dev`; production output uses `.next`. This keeps a development session from overwriting the JavaScript and CSS served by a production session. Use separate ports when running both. After changing this configuration, restart any existing servers and hard-refresh old browser tabs. On Windows, stop running app processes before regenerating Prisma's native client DLL.

```powershell
npm run build
npm start
```

The server needs network access to Aiven and the configured CA file. Production cookies use `Secure`; remote production access needs HTTPS. Browser barcode scanning also needs HTTPS (localhost is a browser exception).

## Environment

Copy `.env.example` to `.env` for a fresh installation and replace placeholders privately. The current workspace is already configured; do not replace its `.env` with the example.

| Variable            | Purpose                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Server-only Prisma MySQL URL. Use `sslcert=certs/aiven-ca.pem&sslaccept=strict&connection_limit=5&pool_timeout=20` for Aiven.                                                      |
| `AUTH_SECRET`       | At least 32 random characters; seals session cookies and hashes database session tokens. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `APP_URL`           | Exact external origin, e.g. `https://inventory.example.com`, without a path. Used to reject cross-origin writes.                                                                   |
| `SETUP_EMAIL`       | First admin email, CLI setup only.                                                                                                                                                 |
| `SETUP_PASSWORD`    | First admin or reset password, CLI only; at least 6 characters, at most 72 bytes. Remove after use.                                                                                                            |
| `TEST_DATABASE_URL` | Optional separate database whose name must start with `inventory_validation_`. Never set this to the application database.                                                         |

Prisma resolves CA paths relative to the `prisma` directory. The provided Aiven certificate is stored in `prisma/certs/aiven-ca.pem`, excluded from version control. Strict certificate validation is enabled, following [Prisma's MySQL TLS documentation](https://docs.prisma.io/docs/orm/v6/overview/databases/mysql). No credentials are sent to the browser.

Fresh installation, after migrations:

```powershell
# Set SETUP_EMAIL and a strong SETUP_PASSWORD privately in .env, then:
npm run setup:user
```

This command refuses to create a second bootstrap owner. Additional users are created by an admin in Settings. An administrator with server access can reset the bootstrap owner's password with `npm run reset:password` after privately setting `SETUP_PASSWORD`; it revokes all sessions. Admins can reset other account passwords through Settings. Accounts are deactivated, never deleted.

## Roles and quantity workflow (23 October 2026)

The app now displays **quantities only**. Prices, payments, monetary totals and financial reports are removed from active screens and inventory exports. Historical financial columns and records remain in MySQL; they are not deleted or exposed by the inventory read API.

| Role           | Access                                                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin          | Product catalog create/edit/archive, suppliers, purchase orders/receipts, central stock, branch allocation/returns, all stock operations, manufacturing receipts, settings and accounts.                                                  |
| Branch manager | Only assigned product balances and branch history. Can record sales, linked returns, losses, damage, expiry and quarantine against their own branch. Cannot manage catalog, assign stock, access another branch or view central balances. |
| Manufacturer   | Production workspace only. Can add new piece-based products, record ready products and dispatches in boxes and pieces; admin confirms receipt. Inventory balances, submission history, inventory pages, reports and exports are not available. |

Create accounts through **Settings > Account management**, selecting Admin, Branch manager or Manufacturer. Account changes revoke sessions. Existing USER accounts migrate to BRANCH_MANAGER and start without any stock allocation. Role changes are blocked while location balances remain. Products are archived instead of deleting historical records. No public registration exists.

### Stock ownership and production

1. Admin registers products under **Inventory**, measured in `pcs` for manufacturing. If a product is missing, a manufacturer can add its name and optional SKU, barcode and category from **Production**; admin can complete other catalog details later.
2. Manufacturer records **Ready products**: `total pieces = boxes ? pieces per box + loose pieces`. This increases only their ready stock.
3. Manufacturer dispatches ready pieces. Their ready balance decreases; the dispatch remains in transit.
4. Admin opens **Production**, where each dispatch is listed under **Waiting to be received**: **Receive all** takes the whole delivery in one step, **Receive part** confirms only some pieces. Only confirmed pieces enter central inventory. Overreceiving is blocked.
   - **Send stock to manufacturer** sends warehouse stock back to a manufacturer. Choose the stock type (good, damaged, expired, or on hold / other); the pieces leave that warehouse balance and the manufacturer sees the delivery on their Production page. The manufacturer's ready stock does not change.
5. Admin uses **Branches > Assign stock in bulk** to transfer central stock to a branch manager. Central stock decreases and branch stock increases atomically.
6. Branch manager sells or returns against their own stock. Admin may also record operations for central or a chosen branch. Returns must reference the original sale and cannot exceed its remaining quantity. Return condition controls sellable/damaged/expired/quarantined balances.
7. Admin can transfer unused sellable branch stock back to central. Admin releases inspected quarantine or disposes unusable stock in central or a chosen branch.

Central balances use Product and StockMovement; branch/manufacturer balances use LocationBalance and immutable QuantityEvent/QuantityLine records. Multi-product changes, source quantity caps, balances and audit entries commit in one transaction. Product locks and conditional decrements prevent negative stock. Persisted request keys and payload fingerprints prevent duplicate batches; transaction retries handle MySQL deadlocks. Manufacturing dispatch receipt is separate from recording dispatch. Quantity-only operations do not update accounting totals; this version must not be used to generate financial statements.

### Bulk and barcode entry

All stock forms accept multiple products (up to 100 in the UI, 200 in the quantity API). Select products or scan their registered barcode/SKU followed by Enter. Repeated scans increment that line by one piece. Review the batch, then choose **Confirm batch**. Camera scanning is available in the same forms; tap **Scan next item** between camera reads. Unknown barcodes must be registered by admin first. Physical USB/Bluetooth scanner hardware still requires testing on your device.

For new products, **Inventory > Bulk import Excel** accepts first-sheet XLSX values, up to 200 products / 2 MB. Only `name` is required. Optional fields include `sku`, `barcode`, `category`, `unit`, `expiryDate`, `minStock`, `openingQuantity`, `notes`, `active`. Opening quantity goes to central inventory and is recorded in its ledger. Prices are not required; legacy price columns are ignored. Excel barcode/SKU columns must be Text to preserve leading zeros. Formulas and numeric barcode/SKU cells are rejected. Use YYYY-MM-DD for expiry dates; Excel date cells are also accepted. Older XLS files must be saved as XLSX.

**Scan products** queues unknown barcodes for catalog creation; repeat scans increase opening quantity. Fill product names and details, validate and confirm. Existing product barcodes belong in stock-operation forms instead. Both imports and scanner queues are atomic, with duplicate identifier validation before saving.

### Sales team and scan-based sales (10 November 2026)

Admin adds salespeople under **Team** with a letter code (e.g. `TRL`). Order IDs are that code followed by numbers (`TRL1023`, `TRL-1023`), so each order is tied to its salesperson.

On **Sales**, type or scan the order ID and press Enter; the cursor moves to the product box. Each product scan (barcode, SKU or exact name + Enter) saves immediately and deducts one piece from stock — no save button. Scanning another order ID in the product box starts the next order; Esc clears. The current order's lines have +/−/remove controls, and the last three orders have **Edit** (order ID and quantities) and **Delete** (returns stock). Admin picks central warehouse or a branch; branch managers sell from their own stock. **Download orders Excel** exports every order with salesperson code.

Orders live in `SalesOrder`/`SalesOrderItem` (migration `202611100001_sales_orders`). Central stock changes are written to the StockMovement ledger as type `ORDER`; branch order lines are included in `npm run db:check`.

### Expiry dates

Product add/edit, bulk XLSX import and inventory tables support an optional expiry date. Expired dates and dates within 30 days are highlighted. Existing products start with no expiry date until admin fills it in. Dates describe the product record; different expiry dates for separate lots of the same barcode are not tracked separately. Expiry dates do not automatically move quantities or prevent sales: record the actual expired quantities with the expiry operation.

### Authentication

Every read is authenticated and role scoped on the server, including reports and Excel exports. All inventory mutations validate the user's actual role and location ownership. Passwords use bcrypt cost 12; opaque database sessions use sealed HttpOnly SameSite Strict cookies, secure in production, expiring after 12 hours. Login attempts are rate limited. Admin cannot demote/deactivate itself or remove the last active admin. Writes check APP_URL origin. Excel exports neutralize spreadsheet formulas. Password hashes, session tokens, database credentials and monetary fields are not returned from inventory reads.

## Database layout and migrations

Additional quantity models: LocationBalance, QuantityEvent, QuantityLine. Product.expiryDate is nullable. Legacy models: User, Session, LoginAttempt, Product (transactionally maintained bucket balances), Supplier, Sale, SaleItem, SalesReturn, ReturnItem, PurchaseOrder, PurchaseOrderItem, PurchaseReceipt, PurchaseReceiptItem, SupplierPayment, StockMovement, AuditLog, Operation (idempotency), and Settings. Foreign keys restrict historical deletion; SKU, barcode and transaction request keys have uniqueness constraints. Product/date/reference indexes support the ledger and reports.

```powershell
npm run db:migrate
```

`prisma migrate deploy` applies committed SQL migrations and never runs a reset. All supplied schema migrations are additive; the role migration converts legacy USER accounts to branch managers. For later changes, use `prisma migrate dev` only against a separate development database with a suitable shadow database; inspect generated SQL, back up production, and then use `migrate deploy`. Never run `migrate reset` or `db push --accept-data-loss` on your live database. A populated pre-existing database must be inspected and baselined before using these initial migrations.

## Validation

```powershell
npm run typecheck
npm run lint
npm run db:check
npm test
npm run build

# Isolated MySQL tests; requires CREATE DATABASE privileges for the prepare step:
npm run test:prepare
npm run test:integration

# Requires a local Chrome installation and the current production build:
npm run test:browser
```

The default tests cover fixed-precision calculations, validation, access protection, CSV safety and role permissions. Integration tests cover stock-changing workflows, partial receiving, payment bounds, duplicate/concurrent requests, return caps, cancellations, archive/history retention, exact ledger balances and report calculations. Integration fixtures are retained only in the dedicated validation database, allowing inspection without modifying the live database. Unit-only runs skip integration tests when `TEST_DATABASE_URL` is absent. Browser checks exercise all three roles, product expiry, quantity-only Excel import, barcode batches, stock allocation, branch sale/return, manufacturer boxes/dispatch, admin receipt, navigation, mobile layout and API authorization. Screenshots are written to the ignored `artifacts` folder. Camera hardware, device permissions and physical USB scanners require a real-device smoke test.

## Deployment

The application can run on any Node-compatible Next.js host, including Vercel, with Aiven remaining the separate MySQL service. It has not been deployed publicly by this implementation.

1. Push source and the lockfile to a private repository, excluding `.env`, local certificates and test artifacts. Use a supported Node LTS runtime.
2. Choose a hosting plan appropriate to the use. [Vercel Hobby](https://vercel.com/docs/plans/hobby) is limited to personal non-commercial use and has usage quotas; business inventory used for financial gain may need a commercial plan. Check the host's current terms and limits. No free commercial hosting entitlement is assumed.
3. Set `DATABASE_URL`, `AUTH_SECRET`, and production `APP_URL` in protected server environment settings. Do not set any `NEXT_PUBLIC_` database or auth variables. Do not deploy `SETUP_PASSWORD` or `TEST_DATABASE_URL`.
4. Supply Aiven's CA at build and runtime. For Vercel, add a protected `AIVEN_CA_BASE64` environment variable containing a base64-encoded copy of your CA, then use the repository's `npm run build:hosted` build command. It writes only `prisma/certs/aiven-ca.pem`, runs `prisma generate`, and builds Next.js. The file is included in Next.js server tracing. Keep the Prisma URL's `sslcert=certs/aiven-ca.pem&sslaccept=strict` options. The certificate is public trust material, but is kept out of source for convenient rotation.
5. Run `npm run db:migrate` once from a trusted administrative machine or controlled release step with network access. Do not create tables per request or run `migrate dev` during deployment. The current Aiven schema is already migrated.
6. Use a least-privilege application database account in production, granting CRUD access required by the application and no schema-drop privileges. Keep migration/backup credentials separately. The supplied Aiven admin credential is currently used only because it was the available connection; replace it with the restricted runtime account when hosting is chosen.
7. Restrict MySQL source IPs to approved application/admin hosts wherever the host provides stable egress or private networking. A host with dynamic serverless egress may require a networking plan or a different hosting arrangement to enforce a strict allowlist; do not broadly expose MySQL just to make deployment work. Keep TLS strict regardless of network controls.
8. The singleton Prisma client reuses a small pool. `connection_limit=5` is per server process, so multiple serverless instances multiply connection usage. Tune it and hosting concurrency to the actual Aiven connection cap. No Prisma Accelerate or alternate database service is required.
9. Enable HTTPS, set `APP_URL` to the exact HTTPS origin, sign in as admin, create a regular user, verify permissions, exports, camera scanning and a small real stock workflow, then inspect ledger reconciliation. Serverless functions need sufficient duration for networked transactions (up to 20 seconds plus overhead). Preview deployments must use a separate database and their own APP_URL.
10. Set up and test backups before relying on the hosted application. Hosting, custom domains, allowlists, monitoring and scheduled backups remain operator setup tasks.

For a conventional Node host, use `npm ci`, supply the CA file, `npm run build`, run reviewed migrations, and start `npm start` behind an HTTPS reverse proxy. This avoids assuming that your Next.js host also provides MySQL.

## Backup and restore

CSV is an export, not a relational backup. Use MySQL 8 client tools and a user permitted to read all tables. Enter passwords at the prompt rather than putting them in command history. Replace placeholders below; do not paste application credentials into documentation.

On Windows, prefer `--result-file` over shell redirection so PowerShell does not re-encode the SQL file:

```powershell
mysqldump --host=MYSQL_HOST --port=MYSQL_PORT --user=BACKUP_USER --password --ssl-mode=VERIFY_IDENTITY --ssl-ca=prisma/certs/aiven-ca.pem --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 --result-file=inventory-backup.sql defaultdb
```

The database contains InnoDB tables; avoid schema changes while the snapshot runs. Check the exit status and backup file size. Encrypt the dump and store it off-host with restricted access. Retain 7 daily and 4 weekly copies, plus a pre-migration backup. Exclude all `*.sql` backup files from source control (migration SQL files are intentionally tracked).

Test a restore into a new, empty database, never directly over live inventory. From an interactive MySQL client:

```powershell
mysql --host=MYSQL_HOST --port=MYSQL_PORT --user=RESTORE_USER --password --ssl-mode=VERIFY_IDENTITY --ssl-ca=prisma/certs/aiven-ca.pem RESTORE_DATABASE
```

Then run `SOURCE C:/absolute/path/inventory-backup.sql;`. Verify row counts, sign-in using a separate application configuration pointing at RESTORE_DATABASE, sale/return totals, purchase receipts, and equality of each product bucket to the sum of its ledger movements. Test at least monthly, and record the restore date and result. Restoring a dump includes sessions; revoke those in the restored database before exposing a restored service. Production recovery should be a deliberate maintenance operation with a fresh backup of the current database.

[Aiven's free MySQL documentation](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier) and the [free-tier overview](https://aiven.io/free-tier) describe provider facilities and restrictions. Check the actual service's backup retention and restore availability in its console; this project has not configured or verified provider backup retention, scheduled dumps, or a restore drill. Do not treat provider backups as the only copy.

## Deliberate limits

The live npm audit after the compatible PostCSS and deepmerge patches reports no runtime dependency advisories. The development-only Next.js ESLint toolchain still pulls `braces` 3.0.3 through fast-glob/micromatch, which has a stack-exhaustion advisory with no patched braces release available during implementation. It processes this repository's controlled lint patterns, not web requests. Recheck `npm audit` when upgrading the lint toolchain; a clean production dependency audit does not claim a clean development dependency audit.

This is a small shared inventory workspace with admin and daily-operation user access, not a multi-tenant or full-accounting product. There are no public registrations, subscriptions, organization roles, batch expiry dates, expense accounting, PDF reports, attachments, return editing/correction, supplier credits, or offline synchronization. Use auditable additional transactions for corrections; original ledger rows cannot be edited through the application. Listing endpoints load history for this small deployment while tables paginate in the browser; very large transaction histories would need server pagination and aggregation. Camera/USB hardware compatibility, automated backup restoration, and public deployment need environment-specific verification.

### Excel files and logout

Use Logout in the header or sidebar (all roles, including mobile). It revokes the current server session and returns to login. All active inventory, operation and report downloads and product templates are native .xlsx workbooks. Bulk product upload accepts .xlsx only, not CSV or legacy .xls. Identifier cells remain text to preserve leading zeros; quantity cells export as numbers. Spreadsheet-like text is stored as literal text, not executable formulas.
