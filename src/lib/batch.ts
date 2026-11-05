import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { InventoryError } from "./errors";

export const LEGACY_BATCH_NO = "LEGACY / UNASSIGNED";
export const legacyIdentity = (productId: string) => `LEGACY:${productId}`;
export function normalizeBatchNo(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("en-US");
}
const batchInput = z.object({
  productId: z.string().min(1).max(191),
  manufacturerId: z.string().min(1).max(191),
  batchNo: z.string().transform(normalizeBatchNo).pipe(
    z.string().min(1).max(191).refine(
      (value) => value !== LEGACY_BATCH_NO,
      "LEGACY / UNASSIGNED is reserved for legacy batches",
    ),
  ),
  mfgDate: z.string().date(),
  expiryDate: z.string().date(),
}).refine((b) => b.mfgDate <= b.expiryDate, "Manufacturing date must not follow expiry date");

// Not connected to any application writer in Phase 1. Call inside a transaction.
// The Product lock serializes identity creation with the existing stock writers.
export async function getOrCreateBatch(tx: Prisma.TransactionClient, raw: z.input<typeof batchInput>) {
  const input = batchInput.parse(raw);
  await tx.$queryRaw`SELECT id FROM Product WHERE id = ${input.productId} FOR UPDATE`;
  const manufacturer = await tx.user.findUnique({ where: { id: input.manufacturerId } });
  if (!manufacturer || manufacturer.role !== "MANUFACTURER" || !manufacturer.active)
    throw new InventoryError("Choose an active manufacturer");
  const existing = await tx.batch.findUnique({
    where: { productId_manufacturerId_batchNo: {
      productId: input.productId, manufacturerId: input.manufacturerId, batchNo: input.batchNo,
    } },
  });
  if (existing) {
    if (existing.mfgDate?.toISOString().slice(0, 10) !== input.mfgDate ||
        existing.expiryDate?.toISOString().slice(0, 10) !== input.expiryDate)
      throw new InventoryError("Batch number already exists with different manufacturing or expiry dates");
    return existing;
  }
  const id = randomUUID();
  return tx.batch.create({ data: {
    ...input, id, identityKey: `BATCH:${id}`,
    mfgDate: new Date(`${input.mfgDate}T00:00:00.000Z`),
    expiryDate: new Date(`${input.expiryDate}T00:00:00.000Z`),
  } });
}
