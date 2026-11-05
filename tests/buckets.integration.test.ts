import { afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { operationSchema } from "../src/lib/validation";
const enabled = !!process.env.TEST_DATABASE_URL;
if (enabled) {
  if (
    !new URL(process.env.TEST_DATABASE_URL!).pathname.startsWith(
      "/inventory_validation_",
    )
  )
    throw new Error("Dedicated validation database required");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const { db } = await import("../src/lib/db");
const { execute } = await import("../src/lib/inventory");
const op = (input: Record<string, unknown>, role = "ADMIN") =>
  execute(
    operationSchema.parse({ requestKey: randomUUID(), ...input }),
    "bucket-test",
    role,
  );
describe.skipIf(!enabled)("bucket transfers and user stock permissions", () => {
  afterAll(() => db.$disconnect());
  it("releases inspected quarantine at its original cost without changing historical sales", async () => {
    const p = await db.product.create({
      data: {
        name: "Quarantine " + randomUUID(),
        purchasePrice: "40",
        sellingPrice: "100",
      },
    });
    await op({
      action: "adjustment",
      productId: p.id,
      type: "OPENING",
      quantity: "2",
      reason: "Opening stock for bucket tests",
    });
    const sale = await op({
      action: "sale",
      items: [{ productId: p.id, quantity: "1" }],
    });
    const item = await db.saleItem.findFirstOrThrow({
      where: { saleId: sale.id },
    });
    await op({
      action: "return",
      reason: "Awaiting inspection of return",
      items: [
        {
          productId: p.id,
          saleItemId: item.id,
          quantity: "1",
          condition: "QUARANTINED",
        },
      ],
    });
    let current = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(current.stock.toString()).toBe("1");
    expect(current.quarantined.toString()).toBe("1");
    await expect(
      op(
        {
          action: "bucketAdjustment",
          productId: p.id,
          bucket: "QUARANTINED",
          type: "RELEASE",
          quantity: "1",
          reason: "Inspection approved by admin",
        },
        "USER",
      ),
    ).rejects.toThrow("Admin");
    await op({
      action: "bucketAdjustment",
      productId: p.id,
      bucket: "QUARANTINED",
      type: "RELEASE",
      quantity: "1",
      reason: "Inspection approved by admin",
    });
    current = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(current.stock.toString()).toBe("2");
    expect(current.quarantined.toString()).toBe("0");
    expect(current.averageCost.toString()).toBe("40");
    expect(
      (
        await db.saleItem.findUniqueOrThrow({ where: { id: item.id } })
      ).returned.toString(),
    ).toBe("1");
    await expect(
      op({
        action: "bucketAdjustment",
        productId: p.id,
        bucket: "QUARANTINED",
        type: "RELEASE",
        quantity: "1",
        reason: "Cannot release absent stock",
      }),
    ).rejects.toThrow("bucket");
  });
  it("disposes unusable stock without changing sellable stock or recognizing loss twice", async () => {
    const p = await db.product.create({
      data: {
        name: "Disposal " + randomUUID(),
        purchasePrice: "30",
        sellingPrice: "60",
      },
    });
    await op({
      action: "adjustment",
      productId: p.id,
      type: "OPENING",
      quantity: "3",
      reason: "Opening for disposal test",
    });
    await op(
      {
        action: "adjustment",
        productId: p.id,
        type: "DAMAGED",
        quantity: "2",
        reason: "Damaged during transit",
      },
      "ADMIN",
    );
    await expect(
      op({
        action: "bucketAdjustment",
        productId: p.id,
        bucket: "DAMAGED",
        type: "RELEASE",
        quantity: "1",
        reason: "Damaged cannot be sold",
      }),
    ).rejects.toThrow("quarantined");
    await op({
      action: "bucketAdjustment",
      productId: p.id,
      bucket: "DAMAGED",
      type: "DISPOSE",
      quantity: "2",
      reason: "Disposed with admin authorization",
    });
    const current = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(current.stock.toString()).toBe("1");
    expect(current.damaged.toString()).toBe("0");
    expect(
      await db.stockMovement.count({
        where: { productId: p.id, type: "DAMAGED", bucket: "SELLABLE" },
      }),
    ).toBe(1);
  });
  it("rejects a user receipt cost override atomically", async () => {
    const p = await db.product.create({
      data: {
        name: "Receipt permissions " + randomUUID(),
        purchasePrice: "10",
        sellingPrice: "20",
      },
    });
    const supplier = await db.supplier.create({
      data: { name: "Supplier " + randomUUID() },
    });
    const po = await op({
      action: "purchase",
      supplierId: supplier.id,
      items: [{ productId: p.id, quantity: "2", unitCost: "10" }],
    });
    const line = await db.purchaseOrderItem.findFirstOrThrow({
      where: { orderId: po.id },
    });
    await expect(
      op(
        {
          action: "receipt",
          orderId: po.id,
          items: [{ orderItemId: line.id, quantity: "1", unitCost: "11" }],
        },
        "USER",
      ),
    ).rejects.toThrow("Admin");
    expect(
      (
        await db.product.findUniqueOrThrow({ where: { id: p.id } })
      ).stock.toString(),
    ).toBe("0");
    await op(
      {
        action: "receipt",
        orderId: po.id,
        items: [{ orderItemId: line.id, quantity: "1", unitCost: "10" }],
      },
      "ADMIN",
    );
    expect(
      (
        await db.product.findUniqueOrThrow({ where: { id: p.id } })
      ).stock.toString(),
    ).toBe("1");
  });
});
