import { db } from "./db";
import { InventoryError } from "./errors";

// Movements that only add or correct stock. A product with nothing else can be removed.
const SETUP_TYPES = ["OPENING", "STOCK_IN", "ADJUSTMENT"];

/**
 * Permanently deletes a product that was never sold, transferred, returned or
 * ordered. Products with history must be archived so old records stay intact.
 */
export async function deleteProduct(id: string, actorId: string) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM Product WHERE id = ${id} FOR UPDATE`;
      const product = await tx.product.findUnique({ where: { id } });
      if (!product) throw new InventoryError("Product not found. Refresh and retry.");
      const [sales, purchases, returns, orders, movements, lines, balances, batches] =
        await Promise.all([
          tx.saleItem.count({ where: { productId: id } }),
          tx.purchaseOrderItem.count({ where: { productId: id } }),
          tx.returnItem.count({ where: { productId: id } }),
          tx.salesOrderItem.count({ where: { productId: id } }),
          tx.stockMovement.count({
            where: { productId: id, type: { notIn: SETUP_TYPES } },
          }),
          tx.quantityLine.count({
            where: { productId: id, event: { type: { not: "STOCK_IN" } } },
          }),
          tx.locationBalance.count({
            where: {
              productId: id,
              OR: [
                { quantity: { not: 0 } },
                { damaged: { not: 0 } },
                { expired: { not: 0 } },
                { quarantined: { not: 0 } },
              ],
            },
          }),
          tx.batch.count({ where: { productId: id } }),
        ]);
      if (sales + purchases + returns + orders + movements + lines + balances + batches > 0)
        throw new InventoryError(
          `"${product.name}" has sales, transfers or other history, so it cannot be deleted. ` +
            "Edit it and untick \"Active product\" to archive it instead.",
        );
      const stockIn = await tx.quantityLine.findMany({
        where: { productId: id },
        select: { eventId: true },
      });
      await tx.quantityLine.deleteMany({ where: { productId: id } });
      for (const eventId of new Set(stockIn.map((l) => l.eventId)))
        if ((await tx.quantityLine.count({ where: { eventId } })) === 0)
          await tx.quantityEvent.delete({ where: { id: eventId } });
      await tx.stockMovement.deleteMany({ where: { productId: id } });
      await tx.locationBalance.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: "PRODUCT_DELETE",
          reference: id,
          actorId,
          detail: JSON.stringify({
            name: product.name,
            sku: product.sku,
            barcode: product.barcode,
            stock: product.stock.toString(),
          }),
        },
      });
      return { id };
    },
    { isolationLevel: "Serializable", timeout: 30000, maxWait: 10000 },
  );
}
