import { PrismaClient } from "@prisma/client";
import { reconcileBatches } from "../src/lib/batch-backfill";
const validation = process.argv.includes("--validation");
if (validation) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.startsWith("/inventory_validation_"))
    throw new Error("Dedicated inventory_validation_ database required");
  process.env.DATABASE_URL = url;
}
const client = new PrismaClient();
reconcileBatches(client).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (result.mismatches.length) process.exitCode = 1;
}).catch(() => {
  console.error("Batch reconciliation unavailable; verify configuration and migration");
  process.exitCode = 1;
}).finally(() => client.$disconnect());
