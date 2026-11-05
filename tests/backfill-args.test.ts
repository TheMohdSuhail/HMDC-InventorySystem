import { describe, expect, it } from "vitest";
import { parseBackfillArgs } from "../src/lib/backfill-args";

const env = {
  DATABASE_URL: "mysql://user:password@localhost/live_inventory",
  TEST_DATABASE_URL: "mysql://user:password@localhost/inventory_validation_args",
};
describe("pure backfill target selection", () => {
  it.each([
    [],
    ["--live", "--validation"],
    ["--live"],
    ["--live", "--backup-confirmed"],
    ["--live", "--confirm-database=live_inventory"],
    ["--live", "--backup-confirmed", "--confirm-database=wrong"],
    ["--validation", "--unknown"],
    ["--validation", "--validation"],
    ["--validation", "--backup-confirmed"],
    ["--validation", "--confirm-database=inventory_validation_args"],
    ["--live-backup-confirmed"],
    ["--live", "--backup-confirmed", "--confirm-database"],
    ["--live", "--backup-confirmed", "--confirm-database="],
    ["--live", "--backup-confirmed", "--confirm-database=live_inventory", "--confirm-database=live_inventory"],
  ])("rejects unsafe arguments %j", (...argv: string[]) => {
    expect(() => parseBackfillArgs(argv, env)).toThrow();
  });
  it("selects live only with both independent confirmations", () => {
    expect(parseBackfillArgs(["--live", "--backup-confirmed", "--confirm-database=live_inventory"], env))
      .toEqual({ mode: "live", databaseName: "live_inventory", url: env.DATABASE_URL });
  });
  it("validation never reads or falls back to DATABASE_URL", () => {
    const guardedEnv = { TEST_DATABASE_URL: env.TEST_DATABASE_URL, get DATABASE_URL(): string { throw new Error("Must not access live URL"); } };
    expect(parseBackfillArgs(["--validation"], guardedEnv).url).toBe(env.TEST_DATABASE_URL);
    expect(() => parseBackfillArgs(["--validation"], { DATABASE_URL: env.TEST_DATABASE_URL })).toThrow("TEST_DATABASE_URL");
  });
  it.each(["mysql://localhost/defaultdb", "mysql://localhost/not_inventory_validation_args"])("rejects non-validation target %s", (url) => {
    expect(() => parseBackfillArgs(["--validation"], { ...env, TEST_DATABASE_URL: url })).toThrow("inventory_validation_");
  });
  it.each(["", "not-a-url", "mysql://localhost/", "https://localhost/inventory_validation_args", "mysql://localhost/inventory_validation_a%2Fb"])("rejects malformed target %s", (url) => {
    expect(() => parseBackfillArgs(["--validation"], { TEST_DATABASE_URL: url })).toThrow();
  });
});
