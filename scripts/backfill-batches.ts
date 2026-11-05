import { PrismaClient } from "@prisma/client";
import { backfillBatches } from "../src/lib/batch-backfill";
import { InventoryError } from "../src/lib/errors";
import { parseBackfillArgs } from "../src/lib/backfill-args";

let client: PrismaClient | undefined;
async function main() {
  const target = parseBackfillArgs(process.argv.slice(2), {
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  });
  client = new PrismaClient({ datasourceUrl: target.url });
  const [actual] = await client.$queryRaw<{ databaseName: string }[]>`SELECT DATABASE() AS databaseName`;
  if (actual?.databaseName !== target.databaseName)
    throw new InventoryError("Connected database does not match the confirmed target");
  console.log(JSON.stringify(await backfillBatches(client), null, 2));
}
main().catch((e) => {
  console.error(e instanceof InventoryError ? e.message : "Batch backfill failed; transaction rolled back. Check database/schema configuration.");
  process.exitCode = 1;
}).finally(() => client?.$disconnect());
