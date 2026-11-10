import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
const enabled = !!process.env.TEST_DATABASE_URL;
if (enabled) {
  if (
    !new URL(process.env.TEST_DATABASE_URL!).pathname.startsWith(
      "/inventory_validation_",
    )
  )
    throw new Error("Dedicated test database required");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const { db } = await import("../src/lib/db");
const { executeQuantity } = await import("../src/lib/quantity");
const { deleteProduct } = await import("../src/lib/product-delete");
const admin = { id: "delete-admin", role: "ADMIN" };

async function product() {
  const p = await db.product.create({
    data: { name: randomUUID(), purchasePrice: "0", sellingPrice: "0" },
  });
  await executeQuantity(
    {
      requestKey: randomUUID(),
      type: "STOCK_IN",
      notes: "Delete validation",
      items: [{ productId: p.id, quantity: "4" }],
    },
    admin,
  );
  return p;
}

describe.skipIf(!enabled)("product delete on MySQL", () => {
  afterAll(() => db.$disconnect());

  it("deletes a product that only received stock", async () => {
    const p = await product();
    await deleteProduct(p.id, admin.id);
    expect(await db.product.findUnique({ where: { id: p.id } })).toBeNull();
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(0);
    expect(await db.quantityLine.count({ where: { productId: p.id } })).toBe(0);
  });

  it("refuses to delete a product that was sold", async () => {
    const p = await product();
    await executeQuantity(
      {
        requestKey: randomUUID(),
        type: "SALE",
        notes: "Delete validation sale",
        items: [{ productId: p.id, quantity: "1" }],
      },
      admin,
    );
    await expect(deleteProduct(p.id, admin.id)).rejects.toThrow(/archive/);
    expect(await db.product.findUnique({ where: { id: p.id } })).not.toBeNull();
  });
});
