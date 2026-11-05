import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { operationSchema } from "../src/lib/validation";
import { D } from "../src/lib/math";
const enabled = !!process.env.TEST_DATABASE_URL;
if (enabled) {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (!url.pathname.startsWith("/inventory_validation_"))
    throw new Error(
      "Integration tests require a dedicated inventory_validation_ database",
    );
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const { db } = await import("../src/lib/db");
const { execute } = await import("../src/lib/inventory");
const { reports } = await import("../src/lib/reports");
const key = () => randomUUID();
const op = (x: unknown) => execute(operationSchema.parse(x));
describe.skipIf(!enabled)(
  "MySQL stock integrity (isolated validation database)",
  () => {
    let productId: string,
      supplierId: string,
      orderId: string,
      itemId: string,
      saleId: string,
      saleItemId: string;
    beforeAll(async () => {
      const supplier = await db.supplier.create({
        data: { name: "TEST supplier " + key() },
      });
      supplierId = supplier.id;
    });
    afterAll(async () => {
      await db.$disconnect();
    });
    it("creates a zero-stock product and enforces unique SKU", async () => {
      const sku = "TEST-" + key();
      const p = await db.product.create({
        data: { name: sku, sku, purchasePrice: "80", sellingPrice: "120" },
      });
      productId = p.id;
      expect(p.stock.toString()).toBe("0");
      await expect(
        db.product.create({
          data: {
            name: "Duplicate",
            sku,
            purchasePrice: "80",
            sellingPrice: "120",
          },
        }),
      ).rejects.toThrow();
    });
    it("records opening stock with a matching movement and cost", async () => {
      await op({
        action: "adjustment",
        requestKey: key(),
        productId,
        quantity: "10",
        unitCost: "80",
        type: "OPENING",
        reason: "Initial stock for integration test",
      });
      const p = await db.product.findUniqueOrThrow({
        where: { id: productId },
      });
      expect(p.stock.toString()).toBe("10");
      expect(p.averageCost.toString()).toBe("80");
      expect(
        await db.stockMovement.count({ where: { productId, type: "OPENING" } }),
      ).toBe(1);
    });
    it("rejects duplicate opening stock", async () => {
      await expect(
        op({
          action: "adjustment",
          requestKey: key(),
          productId,
          quantity: "10",
          type: "OPENING",
          reason: "Cannot repeat opening",
        }),
      ).rejects.toThrow("Opening");
    });
    it("creates an order without increasing stock", async () => {
      const po = await op({
        action: "purchase",
        requestKey: key(),
        supplierId,
        items: [{ productId, quantity: "10", unitCost: "100" }],
      });
      orderId = po.id;
      itemId = (
        await db.purchaseOrderItem.findFirstOrThrow({ where: { orderId } })
      ).id;
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: productId } })
        ).stock.toString(),
      ).toBe("10");
    });
    it("receives a partial delivery and weights actual cost", async () => {
      await op({
        action: "receipt",
        requestKey: key(),
        orderId,
        items: [{ orderItemId: itemId, quantity: "5", unitCost: "100" }],
      });
      const p = await db.product.findUniqueOrThrow({
        where: { id: productId },
      });
      expect(p.stock.toString()).toBe("15");
      expect(p.averageCost.toString()).toBe("86.666667");
      expect(
        (await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } }))
          .status,
      ).toBe("PARTIALLY_RECEIVED");
    });
    it("rejects over-receipts atomically", async () => {
      await expect(
        op({
          action: "receipt",
          requestKey: key(),
          orderId,
          items: [{ orderItemId: itemId, quantity: "6" }],
        }),
      ).rejects.toThrow("pending");
      expect(
        (
          await db.purchaseOrderItem.findUniqueOrThrow({
            where: { id: itemId },
          })
        ).received.toString(),
      ).toBe("5");
    });
    it("completes the remaining receipt", async () => {
      await op({
        action: "receipt",
        requestKey: key(),
        orderId,
        items: [{ orderItemId: itemId, quantity: "5" }],
      });
      expect(
        (await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } }))
          .status,
      ).toBe("RECEIVED");
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: productId } })
        ).stock.toString(),
      ).toBe("20");
    });
    it("records a sale with server-calculated totals and historical COGS", async () => {
      const s = await op({
        action: "sale",
        requestKey: key(),
        items: [{ productId, quantity: "2", discount: "10" }],
      });
      saleId = s.id;
      const row = await db.sale.findUniqueOrThrow({
        where: { id: saleId },
        include: { items: true },
      });
      saleItemId = row.items[0].id;
      expect(row.total.toString()).toBe("230");
      expect(D(row.cogs).minus("180").abs().lt("0.0001")).toBe(true);
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: productId } })
        ).stock.toString(),
      ).toBe("18");
    });
    it("rejects sales beyond available stock with no partial transaction", async () => {
      const requestKey = key();
      await expect(
        op({
          action: "sale",
          requestKey,
          items: [{ productId, quantity: "999" }],
        }),
      ).rejects.toThrow("stock");
      expect(
        await db.operation.findUnique({ where: { key: requestKey } }),
      ).toBeNull();
      expect(await db.sale.findUnique({ where: { requestKey } })).toBeNull();
    });
    it("prevents duplicate stock deductions, including concurrent identical requests", async () => {
      const requestKey = key();
      const input = {
        action: "sale",
        requestKey,
        items: [{ productId, quantity: "1" }],
      };
      const values = await Promise.all([op(input), op(input)]);
      expect(values[0].id).toBe(values[1].id);
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: productId } })
        ).stock.toString(),
      ).toBe("17");
    });
    it("records a sellable partial return using original discounted price", async () => {
      const ret = await op({
        action: "return",
        requestKey: key(),
        reason: "Customer returned unopened product",
        items: [
          { productId, saleItemId, quantity: "1", condition: "SELLABLE" },
        ],
      });
      expect(
        (
          await db.salesReturn.findUniqueOrThrow({ where: { id: ret.id } })
        ).refund.toString(),
      ).toBe("115");
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: productId } })
        ).stock.toString(),
      ).toBe("18");
    });
    it("prevents excessive returns and excessive refunds", async () => {
      await expect(
        op({
          action: "return",
          requestKey: key(),
          reason: "Excessive return quantity",
          items: [
            { productId, saleItemId, quantity: "2", condition: "SELLABLE" },
          ],
        }),
      ).rejects.toThrow("returnable");
      await expect(
        op({
          action: "return",
          requestKey: key(),
          reason: "Excessive requested refund",
          items: [
            {
              productId,
              saleItemId,
              quantity: "1",
              condition: "SELLABLE",
              refund: "116",
            },
          ],
        }),
      ).rejects.toThrow("Refund");
    });
    it("keeps damaged returns out of sellable stock", async () => {
      await op({
        action: "return",
        requestKey: key(),
        reason: "Customer returned damaged product",
        items: [{ productId, saleItemId, quantity: "1", condition: "DAMAGED" }],
      });
      const p = await db.product.findUniqueOrThrow({
        where: { id: productId },
      });
      expect(p.stock.toString()).toBe("18");
      expect(p.damaged.toString()).toBe("1");
    });
    it("records damaged stock as a bucket transfer and refuses over-adjustment", async () => {
      await op({
        action: "adjustment",
        requestKey: key(),
        productId,
        quantity: "2",
        type: "DAMAGED",
        reason: "Packaging damaged during handling",
      });
      const p = await db.product.findUniqueOrThrow({
        where: { id: productId },
      });
      expect(p.stock.toString()).toBe("16");
      expect(p.damaged.toString()).toBe("3");
      await expect(
        op({
          action: "adjustment",
          requestKey: key(),
          productId,
          quantity: "999",
          type: "MISSING",
          reason: "Cannot remove unavailable stock",
        }),
      ).rejects.toThrow("stock");
    });
    it("reverses a cancelled sale while preserving its original records", async () => {
      const s = await op({
        action: "sale",
        requestKey: key(),
        items: [{ productId, quantity: "1" }],
      });
      await op({
        action: "cancelSale",
        requestKey: key(),
        saleId: s.id,
        reason: "Accidental order entered twice",
      });
      expect(
        (await db.sale.findUniqueOrThrow({ where: { id: s.id } })).status,
      ).toBe("CANCELLED");
      expect(await db.saleItem.count({ where: { saleId: s.id } })).toBe(1);
      expect(
        await db.stockMovement.count({
          where: { reference: s.id, type: "SALE_REVERSAL" },
        }),
      ).toBe(1);
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: productId } })
        ).stock.toString(),
      ).toBe("16");
      await expect(
        op({
          action: "cancelSale",
          requestKey: key(),
          saleId,
          reason: "Cannot cancel after return",
        }),
      ).rejects.toThrow("returns");
    });
    it("validates partial payments independently of receipts", async () => {
      await op({
        action: "payment",
        requestKey: key(),
        orderId,
        amount: "400",
        method: "UPI",
      });
      expect(
        (
          await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })
        ).paid.toString(),
      ).toBe("400");
      await expect(
        op({
          action: "payment",
          requestKey: key(),
          orderId,
          amount: "601",
          method: "UPI",
        }),
      ).rejects.toThrow("outstanding");
    });
    it("serializes competing sales against limited stock", async () => {
      const p = await db.product.create({
        data: {
          name: "Concurrency " + key(),
          purchasePrice: "10",
          sellingPrice: "20",
        },
      });
      await op({
        action: "adjustment",
        requestKey: key(),
        productId: p.id,
        quantity: "1",
        type: "OPENING",
        reason: "Single unit for concurrency check",
      });
      const results = await Promise.allSettled([
        op({
          action: "sale",
          requestKey: key(),
          items: [{ productId: p.id, quantity: "1" }],
        }),
        op({
          action: "sale",
          requestKey: key(),
          items: [{ productId: p.id, quantity: "1" }],
        }),
      ]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: p.id } })
        ).stock.toString(),
      ).toBe("0");
    });
    it("reconciles sellable balance exactly to immutable ledger", async () => {
      const p = await db.product.findUniqueOrThrow({
        where: { id: productId },
      });
      const ledger = await db.stockMovement.aggregate({
        where: { productId, bucket: "SELLABLE" },
        _sum: { quantity: true },
      });
      expect(ledger._sum.quantity?.toString()).toBe(p.stock.toString());
    });
    it("produces accurate reports and preserves history after archiving", async () => {
      await db.product.update({
        where: { id: productId },
        data: { active: false },
      });
      const report = await reports(
        new URLSearchParams({ from: "2026-01-01", to: "2030-01-01" }),
      );
      const p = await db.product.findUniqueOrThrow({
        where: { id: productId },
      });
      const row = report.stock.find((x) => x.product === p.name)!;
      expect(row.closing).toBe("16");
      const sales = report.productSales.find((x) => x.product === p.name)!;
      expect(sales.sold).toBe("3");
      expect(sales.returned).toBe("2");
      expect(sales.netSales).toBe("120.00");
      expect(sales.grossProfit).toBe("30.00");
      expect(await db.saleItem.count({ where: { productId } })).toBeGreaterThan(
        0,
      );
    });
  },
);
