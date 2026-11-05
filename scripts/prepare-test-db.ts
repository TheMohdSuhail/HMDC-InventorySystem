import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const db = new PrismaClient();
async function main() {
  const name = "inventory_validation_20261021";
  await db.$executeRawUnsafe(
    `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/" + name;
  if (!process.env.TEST_DATABASE_URL)
    appendFileSync(".env", `\nTEST_DATABASE_URL="${url.toString()}"\n`);
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { stdio: "inherit", env: { ...process.env, DATABASE_URL: url.toString() } },
  );
  if (result.status !== 0) throw new Error("Test schema migration failed");
  console.log(
    "Separate validation database ready; production inventory is untouched.",
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error ? e.message : "Test database preparation failed",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
