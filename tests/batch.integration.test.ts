import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
const enabled = !!process.env.TEST_DATABASE_URL;
if (enabled) {
  if (!new URL(process.env.TEST_DATABASE_URL!).pathname.startsWith("/inventory_validation_"))
    throw new Error("Dedicated validation database required");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const { db } = await import("../src/lib/db");
const { backfillBatchTransaction, reconcileBatchTransaction } = await import("../src/lib/batch-backfill");
const { getOrCreateBatch, legacyIdentity, LEGACY_BATCH_NO } = await import("../src/lib/batch");
const rollback = new Error("intentional fixture rollback");
// Exercise a first backfill even when the shared validation DB retains a prior
// non-authoritative snapshot. These four-table changes ALWAYS roll back; source
// aggregates, events and ledger history are never cleared.
async function clearSnapshotWithinRollback(tx: Prisma.TransactionClient) {
  await tx.saleItemBatch.deleteMany();
  await tx.quantityLineBatch.deleteMany();
  await tx.batchBalance.deleteMany();
  await tx.batch.deleteMany();
}
async function isolated(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db.$transaction(async (tx) => { await clearSnapshotWithinRollback(tx); await fn(tx); throw rollback; }, { isolationLevel: "Serializable", timeout: 60000 });
  } catch (e) { if (e !== rollback) throw e; }
}
async function fixture(tx: Prisma.TransactionClient) {
  const product = await tx.product.create({ data: {
    name: randomUUID(), purchasePrice: "0", sellingPrice: "0", expiryDate: new Date("2027-01-01"), active: false,
  } });
  const manufacturer = await tx.user.create({ data: {
    email: `${randomUUID()}@batch.invalid`, passwordHash: "unused", role: "MANUFACTURER",
  } });
  return { product, manufacturer };
}
describe.skipIf(!enabled)("batch schema and transactional legacy backfill", () => {
  afterAll(() => db.$disconnect());
  it("copies every bucket, only splits outstanding sources, reruns without changes, and preserves original rows", async () => {
    await isolated(async (tx) => {
      const { product: p, manufacturer: m } = await fixture(tx);
      // Quantity event history explains manufacturer stock; central history is separate.
      await tx.product.update({ where: { id: p.id }, data: { stock: "1.125", damaged: "2", expired: "3", quarantined: "4" } });
      for (const [bucket, quantity] of [["SELLABLE", "1.125"], ["DAMAGED", "2"], ["EXPIRED", "3"], ["QUARANTINED", "4"]])
        await tx.stockMovement.create({ data: { productId: p.id, type: "OPENING", bucket, quantity, unitCost: "0", reference: "batch-fixture" } });
      const event = async (type: string, quantity: string, processed = "0") => tx.quantityEvent.create({ data: {
        requestKey: randomUUID(), fingerprint: "test", type, actorId: m.id, ownerId: m.id, notes: "Batch fixture",
        items: { create: { productId: p.id, quantity, processed } },
      }, include: { items: true } });
      await event("READY", "10");
      const dispatch = await event("DISPATCH", "4", "1");
      await event("DISPATCH", "2", "2");
      const sale = await event("SALE", "1", "0.5");
      await tx.locationBalance.create({ data: { ownerId: m.id, productId: p.id, quantity: "3" } });
      const before = await tx.quantityLine.findMany({ where: { productId: p.id } });
      const oldSale = await tx.sale.create({ data: {
        number: randomUUID(), requestKey: randomUUID(), total: "0", gross: "0", discount: "0", cogs: "0",
        items: { create: { productId: p.id, quantity: "2", returned: "1", unitPrice: "0", unitCost: "0", discount: "0", total: "0" } },
      }, include: { items: true } });
      const result = await backfillBatchTransaction(tx);
      expect(result.mismatches).toEqual([]);
      const batch = await tx.batch.findUniqueOrThrow({ where: { identityKey: legacyIdentity(p.id) } });
      expect(batch.mfgDate).toBeNull();
      expect(batch.expiryDate).toBeNull();
      const balance = await tx.batchBalance.findUniqueOrThrow({ where: { ownerId_batchId: { ownerId: "CENTRAL", batchId: batch.id } } });
      expect([balance.quantity, balance.damaged, balance.expired, balance.quarantined].map(String)).toEqual(["1.125", "2", "3", "4"]);
      const splits = await tx.quantityLineBatch.findMany({ where: { batchId: batch.id } });
      expect(splits.map((s) => s.lineId).sort()).toEqual([dispatch.items[0].id, sale.items[0].id].sort());
      expect(splits.find((s) => s.lineId === dispatch.items[0].id)?.processed.toString()).toBe("1");
      expect(await tx.saleItemBatch.count({ where: { saleItemId: oldSale.items[0].id } })).toBe(1);
      const counts = [await tx.batch.count(), await tx.batchBalance.count(), await tx.quantityLineBatch.count(), await tx.saleItemBatch.count()];
      await backfillBatchTransaction(tx);
      expect([await tx.batch.count(), await tx.batchBalance.count(), await tx.quantityLineBatch.count(), await tx.saleItemBatch.count()]).toEqual(counts);
      expect(await tx.quantityLine.findMany({ where: { productId: p.id } })).toEqual(before);
      await tx.batchBalance.update({ where: { ownerId_batchId: { ownerId: "CENTRAL", batchId: batch.id } }, data: { quantity: "2" } });
      expect((await reconcileBatchTransaction(tx)).mismatches.join()).toContain("aggregate=");
      await expect(backfillBatchTransaction(tx)).rejects.toThrow("stale");
    });
  });
  it("rejects different dates for the same product/manufacturer/batch and allows another manufacturer", async () => {
    await isolated(async (tx) => {
      const { product: p, manufacturer: m } = await fixture(tx);
      const input = { productId: p.id, manufacturerId: m.id, batchNo: "LOT-1", mfgDate: "2026-01-01", expiryDate: "2027-01-01" };
      const first = await getOrCreateBatch(tx, input);
      expect((await getOrCreateBatch(tx, input)).id).toBe(first.id);
      await expect(getOrCreateBatch(tx, { ...input, expiryDate: "2028-01-01" })).rejects.toThrow("different");
      await expect(getOrCreateBatch(tx, { ...input, mfgDate: "2026-02-01" })).rejects.toThrow("different");
      await expect(getOrCreateBatch(tx, { ...input, mfgDate: "2028-01-01" })).rejects.toThrow();
      const other = await tx.user.create({ data: { email: `${randomUUID()}@batch.invalid`, passwordHash: "unused", role: "MANUFACTURER" } });
      expect((await getOrCreateBatch(tx, { ...input, manufacturerId: other.id })).id).not.toBe(first.id);
    });
  });
  it("enforces nonnegative buckets and canonical legacy identity in MySQL, not only in TypeScript", async () => {
    await isolated(async (tx) => {
      const { product: p } = await fixture(tx);
      const batch = await tx.batch.create({ data: { productId: p.id, batchNo: LEGACY_BATCH_NO, isLegacy: true, identityKey: legacyIdentity(p.id) } });
      await expect(tx.batch.create({ data: { productId: p.id, batchNo: LEGACY_BATCH_NO, isLegacy: true, identityKey: legacyIdentity(p.id) } })).rejects.toThrow("Batch_identityKey_key");
      await expect(tx.batch.create({ data: { productId: p.id, batchNo: LEGACY_BATCH_NO, isLegacy: true, identityKey: `fake:${p.id}` } })).rejects.toThrow("Batch_identity_check");
      for (const bucket of ["quantity", "damaged", "expired", "quarantined"])
        await expect(tx.batchBalance.create({ data: { ownerId: "CENTRAL", batchId: batch.id, [bucket]: "-0.001" } })).rejects.toThrow("BatchBalance_nonnegative_check");
    });
  });
  it("resolves normalized batch identities, preserves punctuation and rejects the reserved name", async () => {
    await isolated(async (tx) => {
      const { product: p, manufacturer: m } = await fixture(tx);
      const input = { productId: p.id, manufacturerId: m.id, mfgDate: "2026-01-01", expiryDate: "2027-01-01" };
      const first = await getOrCreateBatch(tx, { ...input, batchNo: " ab12 " });
      expect(first.batchNo).toBe("AB12");
      expect((await getOrCreateBatch(tx, { ...input, batchNo: "AB12" })).id).toBe(first.id);
      const spaced = await getOrCreateBatch(tx, { ...input, batchNo: "ab \t 12" });
      expect(spaced.batchNo).toBe("AB 12");
      expect((await getOrCreateBatch(tx, { ...input, batchNo: "ab 12" })).id).toBe(spaced.id);
      expect(spaced.id).not.toBe(first.id);
      expect((await getOrCreateBatch(tx, { ...input, batchNo: "AB-12" })).id).not.toBe(first.id);
      await expect(getOrCreateBatch(tx, { ...input, batchNo: " legacy  /  unassigned " })).rejects.toThrow("reserved");
    });
  });
  it("reconciles the sum of multiple database batches per product/location/bucket", async () => {
    await isolated(async (tx) => {
      const { product: p, manufacturer: m } = await fixture(tx);
      await tx.product.update({ where: { id: p.id }, data: { stock: "0.3", damaged: "3", expired: "5", quarantined: "7" } });
      for (const [bucket, quantity] of [["SELLABLE", "0.3"], ["DAMAGED", "3"], ["EXPIRED", "5"], ["QUARANTINED", "7"]])
        await tx.stockMovement.create({ data: { productId: p.id, type: "OPENING", bucket, quantity, unitCost: "0", reference: "batch-invariant" } });
      await backfillBatchTransaction(tx);
      const legacy = await tx.batch.findUniqueOrThrow({ where: { identityKey: legacyIdentity(p.id) } });
      await tx.batchBalance.update({ where: { ownerId_batchId: { ownerId: "CENTRAL", batchId: legacy.id } }, data: { quantity: "0", damaged: "0", expired: "0", quarantined: "0" } });
      for (const [batchNo, quantity, damaged, expired, quarantined] of [["A", "0.1", "1", "2", "3"], ["B", "0.2", "2", "3", "4"]]) {
        const b = await getOrCreateBatch(tx, { productId: p.id, manufacturerId: m.id, batchNo, mfgDate: "2026-01-01", expiryDate: "2027-01-01" });
        await tx.batchBalance.create({ data: { ownerId: "CENTRAL", batchId: b.id, quantity, damaged, expired, quarantined } });
      }
      expect((await reconcileBatchTransaction(tx)).mismatches).toEqual([]);
      await expect(backfillBatchTransaction(tx)).rejects.toThrow("real batches");
    });
  });
  it("rolls back all batch inserts when a later source line is invalid", async () => {
    const productId = randomUUID();
    const count = await db.batch.count();
    await expect(db.$transaction(async (tx) => {
      await clearSnapshotWithinRollback(tx);
      const { manufacturer: m } = await fixture(tx);
      await tx.product.create({ data: { id: productId, name: productId, purchasePrice: "0", sellingPrice: "0" } });
      await tx.quantityEvent.create({ data: {
        requestKey: randomUUID(), fingerprint: "test", type: "SALE", actorId: m.id, ownerId: "CENTRAL", notes: "Invalid source fixture",
        items: { create: { productId, quantity: "1", processed: "2" } },
      } });
      await backfillBatchTransaction(tx);
    }, { isolationLevel: "Serializable", timeout: 60000 })).rejects.toThrow("Invalid quantity source line");
    expect(await db.batch.count()).toBe(count);
    expect(await db.product.findUnique({ where: { id: productId } })).toBeNull();
  });
});
