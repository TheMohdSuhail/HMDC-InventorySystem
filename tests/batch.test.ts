import { describe, expect, it } from "vitest";
import { compareBalances, reconcileBatchTransaction, type BalanceRow } from "../src/lib/batch-backfill";
import { legacyIdentity, normalizeBatchNo } from "../src/lib/batch";
import type { Prisma } from "@prisma/client";

const row = (extra: Partial<BalanceRow> = {}): BalanceRow => ({
  productId: "p", ownerId: "CENTRAL", quantity: "0", damaged: "0", expired: "0", quarantined: "0", ...extra,
});

describe("source cap reconciliation before split checks", () => {
  async function reconcile(type: "DISPATCH" | "SALE" | "LEGACY_SALE", quantity: string, counter: string) {
    const source = { id: "source", productId: "p", quantity, batches: [] };
    const tx = {
      product: { findMany: async () => [{ id: "p", stock: "0", damaged: "0", expired: "0", quarantined: "0" }] },
      locationBalance: { findMany: async () => [] },
      user: { findMany: async () => [] },
      batchBalance: { findMany: async () => [] },
      batch: { findMany: async () => [{ productId: "p", identityKey: legacyIdentity("p") }] },
      quantityLine: { findMany: async () => type === "LEGACY_SALE" ? [] : [{ ...source, event: { type }, processed: counter }] },
      saleItem: { findMany: async () => type !== "LEGACY_SALE" ? [] : [{ ...source, sale: { status: "COMPLETED" }, returned: counter }] },
    } as unknown as Prisma.TransactionClient;
    return reconcileBatchTransaction(tx);
  }
  for (const type of ["DISPATCH", "SALE", "LEGACY_SALE"] as const) {
    it.each([["1", "2"], ["1", "-0.001"], ["0", "0"], ["-1", "0"]])(
      `${type}: rejects quantity=%s counter=%s without splits`, async (quantity, counter) => {
        expect((await reconcile(type, quantity, counter)).mismatches.join()).toMatch(/invalid .* source cap/);
      },
    );
    it(`${type}: accepts a valid fully processed historical source without splits`, async () => {
      expect((await reconcile(type, "1.125", "1.125")).mismatches).toEqual([]);
    });
  }
});

describe("batch number normalization", () => {
  it("trims and uppercases using en-US", () => {
    expect(normalizeBatchNo(" ab12 ")).toBe("AB12");
    expect(normalizeBatchNo("AB12")).toBe("AB12");
  });
  it("collapses internal whitespace without removing word boundaries", () => {
    expect(normalizeBatchNo(" ab \t 12 \n")).toBe("AB 12");
    expect(normalizeBatchNo("ab 12")).toBe("AB 12");
    expect(normalizeBatchNo("ab 12")).not.toBe(normalizeBatchNo("ab12"));
  });
  it("preserves punctuation", () => {
    expect(normalizeBatchNo(" ab-12 / c.3 ")).toBe("AB-12 / C.3");
    expect(normalizeBatchNo("AB-12")).not.toBe(normalizeBatchNo("AB12"));
  });
});
describe("batch balance invariant", () => {
  it("sums multiple batches exactly in every product/location/bucket", () => {
    const aggregate = [row({ quantity: "0.3", damaged: "3", expired: "4", quarantined: "5" }), row({ ownerId: "branch", quantity: "1" })];
    expect(compareBalances(aggregate, [
      row({ quantity: "0.1", damaged: "1", expired: "1", quarantined: "2" }),
      row({ quantity: "0.2", damaged: "2", expired: "3", quarantined: "3" }),
      row({ ownerId: "branch", quantity: "1" }),
    ])).toEqual([]);
  });
  it("detects missing, extra, negative and wrong-location balances", () => {
    expect(compareBalances([row({ quantity: "1" })], [])).toHaveLength(1);
    expect(compareBalances([], [row({ ownerId: "other", expired: "1" })])).toHaveLength(1);
    expect(compareBalances([row({ quantity: "1" })], [row({ ownerId: "branch", quantity: "1" })])).toHaveLength(2);
    expect(compareBalances([], [row({ damaged: "-1" })]).join()).toContain("negative");
  });
  it("uses an unambiguous non-null legacy identity per product", () => {
    expect(legacyIdentity("a")).toBe("LEGACY:a");
    expect(legacyIdentity("a")).not.toBe(legacyIdentity("b"));
  });
});
