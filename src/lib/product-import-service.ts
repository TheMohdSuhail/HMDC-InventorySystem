import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { D } from "./math";
import { InventoryError } from "./errors";
import {
  importRowSchema,
  normalizeImportRow,
  validateImport,
} from "./product-import";
const action = "BULK_PRODUCTS";
export async function importProducts(
  rows: Record<string, string>[],
  requestKey: string,
  actorId: string,
) {
  const preview = validateImport(rows);
  if (preview.issues.length)
    throw new InventoryError("Fix all row errors before importing");
  const parsed = rows.map((row) =>
    importRowSchema.parse(normalizeImportRow(row)),
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(parsed))
    .digest("hex");
  const replay = (prior: { action: string; result: string }) => {
    if (prior.action !== action)
      throw new InventoryError("Request key already used");
    const result = JSON.parse(prior.result);
    if (result.fingerprint !== fingerprint)
      throw new InventoryError(
        "This request was already saved with different rows. Start a new batch.",
      );
    return result;
  };
  const prior = await db.operation.findUnique({ where: { key: requestKey } });
  if (prior) return replay(prior);
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.operation.create({
            data: { key: requestKey, action, result: "null" },
          });
          const catalog = await tx.product.findMany({
            select: { sku: true, barcode: true },
          });
          const checked = validateImport(rows, catalog);
          if (checked.issues.length)
            throw new InventoryError(
              `Catalog changed or duplicate identifiers: row ${checked.issues[0].row}, ${checked.issues[0].message}. Preview again.`,
            );
          const settings = await tx.settings.findUnique({ where: { id: 1 } });
          const products = parsed.map(({ openingQuantity, ...fields }) => ({
            ...fields,
            expiryDate: fields.expiryDate
              ? new Date(fields.expiryDate + "T00:00:00.000Z")
              : null,
            id: randomUUID(),
            sku: fields.sku || null,
            barcode: fields.barcode || null,
            minStock: fields.minStock ?? settings?.minStock.toString() ?? "5",
            stock: openingQuantity,
            averageCost: D(openingQuantity).gt(0) ? fields.purchasePrice : "0",
          }));
          const ids = products.map((p) => p.id);
          await tx.product.createMany({ data: products });
          const movements = products
            .filter((p) => D(p.stock).gt(0))
            .map((p) => ({
              productId: p.id,
              type: "OPENING",
              bucket: "SELLABLE",
              quantity: p.stock,
              unitCost: p.purchasePrice,
              reference: requestKey,
              reason: "Existing inventory entered through bulk product import",
            }));
          if (movements.length)
            await tx.stockMovement.createMany({ data: movements });
          const result = { count: ids.length, ids, fingerprint };
          // Each snapshot fits AuditLog's TEXT column even with long product notes.
          // A single 200-row JSON snapshot could exceed MySQL's 64 KB TEXT limit.
          await tx.auditLog.createMany({
            data: products.map((p) => ({
              action: "PRODUCT_CREATE",
              reference: p.id,
              actorId,
              detail: JSON.stringify({ ...p, importReference: requestKey }),
            })),
          });
          await tx.auditLog.create({
            data: {
              action,
              reference: requestKey,
              actorId,
              detail: JSON.stringify({
                count: ids.length,
                productIds: ids,
                fingerprint,
              }),
            },
          });
          await tx.operation.update({
            where: { key: requestKey },
            data: { result: JSON.stringify(result) },
          });
          return result;
        },
        { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === "P2002") {
          const saved = await db.operation.findUnique({
            where: { key: requestKey },
          });
          if (saved) return replay(saved);
          throw new InventoryError(
            "A SKU or barcode already exists. Preview again; no products were imported.",
          );
        }
        if (e.code === "P2034" && attempt < 2) continue;
      }
      throw e;
    }
  throw new InventoryError("Concurrent catalog change. Preview and try again.");
}
