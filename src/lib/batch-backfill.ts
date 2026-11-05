import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { D } from "./math";
import { InventoryError } from "./errors";
import { LEGACY_BATCH_NO, legacyIdentity } from "./batch";

const buckets = ["quantity", "damaged", "expired", "quarantined"] as const;
type Value = { toString(): string } | string;
type Buckets = Record<(typeof buckets)[number], Value>;
export type BalanceRow = Buckets & { productId: string; ownerId: string };
const key = (row: { productId: string; ownerId: string }, bucket: string) =>
  JSON.stringify([row.productId, row.ownerId, bucket]);

// Compare the union, so unexpected batch balances and missing aggregate rows fail too.
export function compareBalances(aggregate: BalanceRow[], batches: BalanceRow[]) {
  const expected = new Map<string, ReturnType<typeof D>>();
  const actual = new Map<string, ReturnType<typeof D>>();
  const errors: string[] = [];
  for (const [rows, totals] of [[aggregate, expected], [batches, actual]] as const)
    for (const row of rows)
      for (const bucket of buckets) {
        const value = D(row[bucket]);
        if (!value.isFinite() || value.lt(0)) errors.push(`${key(row, bucket)}: invalid negative/nonfinite balance`);
        totals.set(key(row, bucket), (totals.get(key(row, bucket)) ?? D(0)).plus(value));
      }
  for (const k of new Set([...expected.keys(), ...actual.keys()]))
    if (!(expected.get(k) ?? D(0)).eq(actual.get(k) ?? D(0)))
      errors.push(`${k}: aggregate=${expected.get(k) ?? 0}, batches=${actual.get(k) ?? 0}`);
  return errors;
}

async function sourceSnapshot(tx: Prisma.TransactionClient) {
  const products = await tx.product.findMany({ orderBy: { id: "asc" } });
  const locations = await tx.locationBalance.findMany();
  const ids = new Set(products.map((p) => p.id));
  const owners = new Map((await tx.user.findMany()).map((u) => [u.id, u]));
  for (const b of locations)
    if (!ids.has(b.productId) || b.ownerId === "CENTRAL" || !owners.has(b.ownerId))
      throw new InventoryError("Orphan or reserved location balance; reconcile before backfill");
  const aggregate: BalanceRow[] = [
    ...products.map((p) => ({ ...p, productId: p.id, ownerId: "CENTRAL", quantity: p.stock })),
    ...locations,
  ];
  if (compareBalances(aggregate, aggregate).length)
    throw new InventoryError("Negative aggregate balance; reconcile before backfill");
  return { products, locations, aggregate, ids };
}

// Validate the existing ledgers before creating a snapshot; never repair source data.
async function assertSourceLedgers(tx: Prisma.TransactionClient, aggregate: BalanceRow[]) {
  const totals = new Map<string, BalanceRow>();
  const add = (ownerId: string, productId: string, bucket: (typeof buckets)[number], value: Value) => {
    const k = JSON.stringify([productId, ownerId]);
    const row = totals.get(k) ?? { ownerId, productId, quantity: "0", damaged: "0", expired: "0", quarantined: "0" };
    row[bucket] = D(row[bucket]).plus(value.toString()).toString();
    totals.set(k, row);
  };
  const bucketMap = { SELLABLE: "quantity", DAMAGED: "damaged", EXPIRED: "expired", QUARANTINED: "quarantined" } as const;
  for (const m of await tx.stockMovement.findMany()) {
    const bucket = bucketMap[m.bucket as keyof typeof bucketMap];
    if (!bucket) throw new InventoryError("Unknown central ledger bucket");
    add("CENTRAL", m.productId, bucket, m.quantity);
  }
  const events = await tx.quantityEvent.findMany({ where: { ownerId: { not: "CENTRAL" } }, include: { items: true } });
  for (const e of events) for (const i of e.items) {
    const negative = D(i.quantity).neg().toString();
    if (["ASSIGN", "READY"].includes(e.type)) add(e.ownerId, i.productId, "quantity", i.quantity);
    else if (e.type === "RETURN") {
      const bucket = bucketMap[e.condition as keyof typeof bucketMap];
      if (!bucket) throw new InventoryError("Unknown return condition");
      add(e.ownerId, i.productId, bucket, i.quantity);
    } else if (["BRANCH_RETURN", "SALE", "LOSS", "DISPATCH"].includes(e.type))
      add(e.ownerId, i.productId, "quantity", negative);
    else if (["DAMAGED", "EXPIRED", "QUARANTINED"].includes(e.type)) {
      add(e.ownerId, i.productId, "quantity", negative);
      add(e.ownerId, i.productId, e.type.toLowerCase() as (typeof buckets)[number], i.quantity);
    } else if (e.type === "RELEASE") {
      add(e.ownerId, i.productId, "quarantined", negative);
      add(e.ownerId, i.productId, "quantity", i.quantity);
    } else if (["DISPOSE_DAMAGED", "DISPOSE_EXPIRED", "DISPOSE_QUARANTINED"].includes(e.type))
      add(e.ownerId, i.productId, e.type.slice(8).toLowerCase() as (typeof buckets)[number], negative);
    else throw new InventoryError("Unexpected noncentral ledger operation");
  }
  const errors = compareBalances(aggregate, [...totals.values()]);
  if (errors.length) throw new InventoryError(`Existing ledger mismatch: ${errors.join("; ")}`);
}

export async function reconcileBatchTransaction(tx: Prisma.TransactionClient) {
  const { products, locations, aggregate } = await sourceSnapshot(tx);
  const rows = await tx.batchBalance.findMany({ include: { batch: true } });
  const mismatches = compareBalances(aggregate, rows.map((b) => ({ ...b, productId: b.batch.productId })));
  const legacy = await tx.batch.findMany({ where: { isLegacy: true } });
  for (const p of products)
    if (!legacy.some((b) => b.productId === p.id && b.identityKey === legacyIdentity(p.id)))
      mismatches.push(`${p.id}: missing legacy batch`);
  // Validate every explicit split; absence means legacy for historical rows.
  for (const line of await tx.quantityLine.findMany({ include: { event: true, batches: { include: { batch: true } } } })) {
    const event = line.event;
    const selected = ["SALE", "DISPATCH"].includes(event.type);
    if (selected && (D(line.quantity).lte(0) || D(line.processed).lt(0) || D(line.processed).gt(line.quantity)))
      mismatches.push(`${line.id}: invalid quantity source cap (quantity must be positive; processed must be between zero and quantity)`);
    const relevant = selected && D(line.quantity).gt(line.processed);
    if (relevant && !line.batches.length) mismatches.push(`${line.id}: missing active source split`);
    if (line.batches.length && (
      line.batches.some((b) => b.batch.productId !== line.productId) ||
      !line.batches.reduce((s, b) => s.plus(b.quantity.toString()), D(0)).eq(line.quantity) ||
      !line.batches.reduce((s, b) => s.plus(b.processed.toString()), D(0)).eq(line.processed)
    )) mismatches.push(`${line.id}: quantity source split mismatch`);
  }
  for (const line of await tx.saleItem.findMany({ include: { sale: true, batches: { include: { batch: true } } } })) {
    if (line.sale.status === "COMPLETED" && (D(line.quantity).lte(0) || D(line.returned).lt(0) || D(line.returned).gt(line.quantity)))
      mismatches.push(`${line.id}: invalid sale source cap (quantity must be positive; returned must be between zero and quantity)`);
    if (line.sale.status === "COMPLETED" && D(line.quantity).gt(line.returned) && !line.batches.length)
      mismatches.push(`${line.id}: missing returnable legacy sale split`);
    if (line.batches.length && (
      line.batches.some((b) => b.batch.productId !== line.productId) ||
      !line.batches.reduce((s, b) => s.plus(b.quantity.toString()), D(0)).eq(line.quantity) ||
      !line.batches.reduce((s, b) => s.plus(b.returned.toString()), D(0)).eq(line.returned)
    )) mismatches.push(`${line.id}: sale source split mismatch`);
  }
  return { products: products.length, locations: locations.length, batchBalances: rows.length, mismatches };
}

export async function reconcileBatches(client: PrismaClient) {
  return client.$transaction(reconcileBatchTransaction, { isolationLevel: "RepeatableRead", timeout: 60000 });
}

export async function backfillBatchTransaction(tx: Prisma.TransactionClient) {
    // Maintenance window required. These range locks also protect products/locations
    // inserted during this transaction under MySQL Serializable isolation.
    await tx.$queryRaw`SELECT id FROM Product ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT ownerId, productId FROM LocationBalance ORDER BY ownerId, productId FOR UPDATE`;
    const { products, aggregate, ids } = await sourceSnapshot(tx);
    await assertSourceLedgers(tx, aggregate);
    if (await tx.batch.count({ where: { isLegacy: false } }))
      throw new InventoryError("Legacy-only backfill cannot run after real batches exist");
    const existingBatches = await tx.batch.findMany();
    const batches = new Map(existingBatches.map((b) => [b.productId, b.id]));
    const newBatches = products.filter((p) => !batches.has(p.id)).map((p) => {
      const id = randomUUID();
      batches.set(p.id, id);
      return { id, productId: p.id, identityKey: legacyIdentity(p.id), batchNo: LEGACY_BATCH_NO, isLegacy: true };
    });
    if (newBatches.length) await tx.batch.createMany({ data: newBatches });
    const existingBalances = new Map((await tx.batchBalance.findMany()).map((b) => [JSON.stringify([b.ownerId, b.batchId]), b]));
    const newBalances: Prisma.BatchBalanceCreateManyInput[] = [];
    for (const row of aggregate) {
      const batchId = batches.get(row.productId)!;
      const existing = existingBalances.get(JSON.stringify([row.ownerId, batchId]));
      if (existing) {
        if (buckets.some((b) => !D(existing[b]).eq(row[b].toString())))
          throw new InventoryError("Batch snapshot is stale; refusing to overwrite balances");
      } else newBalances.push({
        ownerId: row.ownerId, batchId,
        quantity: row.quantity.toString(), damaged: row.damaged.toString(),
        expired: row.expired.toString(), quarantined: row.quarantined.toString(),
      });
    }
    if (newBalances.length) await tx.batchBalance.createMany({ data: newBalances });
    const lines = await tx.quantityLine.findMany({ where: { event: { type: { in: ["SALE", "DISPATCH"] } } } });
    const existingLines = new Set((await tx.quantityLineBatch.findMany()).map((b) => b.lineId));
    const newLines: Prisma.QuantityLineBatchCreateManyInput[] = [];
    for (const line of lines) {
      if (!ids.has(line.productId) || D(line.processed).lt(0) || D(line.processed).gt(line.quantity) || D(line.quantity).lte(0))
        throw new InventoryError("Invalid quantity source line; reconcile before backfill");
      if (D(line.quantity).eq(line.processed)) continue;
      if (!existingLines.has(line.id)) newLines.push({ lineId: line.id, batchId: batches.get(line.productId)!, quantity: line.quantity, processed: line.processed });
    }
    if (newLines.length) await tx.quantityLineBatch.createMany({ data: newLines });
    const sales = await tx.saleItem.findMany({ where: { sale: { status: "COMPLETED" } } });
    const existingSales = new Set((await tx.saleItemBatch.findMany()).map((b) => b.saleItemId));
    const newSales: Prisma.SaleItemBatchCreateManyInput[] = [];
    for (const line of sales) {
      if (D(line.returned).lt(0) || D(line.returned).gt(line.quantity) || D(line.quantity).lte(0))
        throw new InventoryError("Invalid legacy sale source line; reconcile before backfill");
      if (D(line.quantity).eq(line.returned)) continue;
      if (!existingSales.has(line.id)) newSales.push({ saleItemId: line.id, batchId: batches.get(line.productId)!, quantity: line.quantity, returned: line.returned });
    }
    if (newSales.length) await tx.saleItemBatch.createMany({ data: newSales });
    const result = await reconcileBatchTransaction(tx);
    if (result.mismatches.length) throw new InventoryError(`Batch reconciliation failed: ${result.mismatches.join("; ")}`);
    return result;
}

export async function backfillBatches(client: PrismaClient) {
  return client.$transaction(backfillBatchTransaction, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000, maxWait: 10000,
  });
}
