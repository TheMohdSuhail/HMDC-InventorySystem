import { afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
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
const { importProducts } = await import("../src/lib/product-import-service");
describe.skipIf(!enabled)("atomic MySQL bulk product import", () => {
  it("imports a 50-product batch with long notes without overflowing audit records", async () => {
    const suffix = randomUUID();
    const rows = Array.from({ length: 50 }, (_, i) => ({
      name: `Large batch ${suffix} ${i}`,
      sku: `LARGE-${suffix}-${i}`,
      purchasePrice: "0.1",
      sellingPrice: "0.3",
      openingQuantity: "1",
      notes: "x".repeat(2000),
    }));
    const result = await importProducts(rows, randomUUID(), "bulk-test");
    expect(result.count).toBe(50);
    expect(await db.product.count({ where: { id: { in: result.ids } } })).toBe(
      50,
    );
    expect(
      await db.auditLog.count({
        where: { action: "PRODUCT_CREATE", reference: { in: result.ids } },
      }),
    ).toBe(50);
  });
  afterAll(() => db.$disconnect());
  it("creates products, exact opening stock, ledger and actor audit atomically and retries once", async () => {
    const suffix = randomUUID();
    const requestKey = randomUUID();
    const rows: Record<string, string>[] = [
      {
        name: "Bulk A " + suffix,
        sku: "BULK-" + suffix,
        barcode: "00" + suffix,
        purchasePrice: "80.25",
        sellingPrice: "120",
        openingQuantity: "2.5",
      },
      {
        name: "Bulk B " + suffix,
        purchasePrice: "10",
        sellingPrice: "20",
        openingQuantity: "0",
      },
    ];
    const [first, retry] = await Promise.all([
      importProducts(rows, requestKey, "bulk-test"),
      importProducts(rows, requestKey, "bulk-test"),
    ]);
    expect(first.ids).toEqual(retry.ids);
    expect(first.count).toBe(2);
    const p = await db.product.findUniqueOrThrow({
      where: { id: first.ids[0] },
    });
    expect(p.stock.toString()).toBe("2.5");
    expect(p.averageCost.toString()).toBe("0");
    expect(p.barcode).toBe("00" + suffix);
    expect(
      await db.stockMovement.count({ where: { reference: requestKey } }),
    ).toBe(1);
    expect(
      (await db.auditLog.findFirstOrThrow({ where: { reference: requestKey } }))
        .actorId,
    ).toBe("bulk-test");
    expect(
      (
        await db.product.findUniqueOrThrow({ where: { id: first.ids[1] } })
      ).stock.toString(),
    ).toBe("0");
    await expect(
      importProducts(
        [{ ...rows[0], name: "Changed" }],
        requestKey,
        "bulk-test",
      ),
    ).rejects.toThrow("different");
  });
  it("rejects duplicate catalog identifiers without creating any partial products", async () => {
    const sku = "EXISTING-" + randomUUID();
    await db.product.create({
      data: { name: sku, sku, purchasePrice: "1", sellingPrice: "2" },
    });
    const unique = "ROLLBACK-" + randomUUID();
    const requestKey = randomUUID();
    await expect(
      importProducts(
        [
          {
            name: unique,
            purchasePrice: "1",
            sellingPrice: "2",
            openingQuantity: "2",
          },
          { name: "Duplicate", sku, purchasePrice: "1", sellingPrice: "2" },
        ],
        requestKey,
        "bulk-test",
      ),
    ).rejects.toThrow("duplicate");
    expect(await db.product.findFirst({ where: { name: unique } })).toBeNull();
    expect(
      await db.operation.findUnique({ where: { key: requestKey } }),
    ).toBeNull();
    expect(
      await db.stockMovement.count({ where: { reference: requestKey } }),
    ).toBe(0);
  });
});
