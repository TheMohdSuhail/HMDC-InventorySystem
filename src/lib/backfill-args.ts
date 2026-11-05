import { InventoryError } from "./errors";

type BackfillEnv = { DATABASE_URL?: string; TEST_DATABASE_URL?: string };

// argv contains arguments only (process.argv.slice(2)); no I/O or DB connection.
export function parseBackfillArgs(argv: readonly string[], env: BackfillEnv) {
  const flags = new Set<string>();
  let confirmation: string | undefined;
  for (const arg of argv) {
    const name = arg.startsWith("--confirm-database=") ? "--confirm-database" : arg;
    if (!["--validation", "--live", "--backup-confirmed", "--confirm-database"].includes(name) || arg === "--confirm-database")
      throw new InventoryError(`Unknown backfill argument: ${arg}`);
    if (flags.has(name)) throw new InventoryError(`Duplicate backfill argument: ${name}`);
    flags.add(name);
    if (name === "--confirm-database") confirmation = arg.slice("--confirm-database=".length);
  }
  if (flags.has("--validation") === flags.has("--live"))
    throw new InventoryError("Choose exactly one of --validation or --live");
  const mode = flags.has("--validation") ? "validation" : "live";
  if (mode === "validation" && (flags.has("--backup-confirmed") || confirmation !== undefined))
    throw new InventoryError("Live confirmation flags cannot be used with --validation");
  const url = mode === "validation" ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  let databaseName: string;
  try {
    if (!url) throw new Error();
    const parsed = new URL(url);
    if (parsed.protocol !== "mysql:" || !parsed.hostname || !parsed.pathname.startsWith("/")) throw new Error();
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
    if (!databaseName || /[/\\\u0000]/.test(databaseName)) throw new Error();
  } catch {
    throw new InventoryError(`Configure a valid ${mode === "validation" ? "TEST_DATABASE_URL" : "DATABASE_URL"} with a database name`);
  }
  if (mode === "validation" && !databaseName.startsWith("inventory_validation_"))
    throw new InventoryError("Dedicated inventory_validation_ database required");
  if (mode === "live" && (!flags.has("--backup-confirmed") || confirmation !== databaseName))
    throw new InventoryError("Live backfill requires --backup-confirmed and --confirm-database=<exact database name>");
  return { mode, databaseName, url: url! };
}
