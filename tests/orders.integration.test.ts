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
const orders = await import("../src/lib/orders");
const { workspace } = await import("../src/lib/workspace");
const admin = { id: "orders-admin", role: "ADMIN", email: "admin@test.invalid" };

const stock = async (id: string) =>
  (await db.product.findUniqueOrThrow({ where: { id } })).stock.toString();

async function fixture() {
  const suffix = randomUUID().replace(/-/g, "");
  const code = Array.from({ length: 10 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join("");
  await orders.saveTeamMember({ name: "Test seller", code }, admin);
  const p = await db.product.create({
    data: { name: suffix, barcode: suffix, purchasePrice: "0", sellingPrice: "0" },
  });
  await executeQuantity(
    {
      requestKey: randomUUID(),
      type: "STOCK_IN",
      notes: "Order validation",
      items: [{ productId: p.id, quantity: "5" }],
    },
    admin,
  );
  return { code, p, orderNo: `${code}${Date.now()}` };
}

describe.skipIf(!enabled)("scan sales orders on MySQL", () => {
  afterAll(() => db.$disconnect());

  it("saves each scan, edits, deletes and keeps stock exact", async () => {
    const { code, p, orderNo } = await fixture();
    const first = await orders.scanToOrder({ orderNo, code: p.barcode }, admin);
    expect(first.order.teamMember.code).toBe(code);
    await Promise.all([
      orders.scanToOrder({ orderNo, code: p.barcode }, admin),
      orders.scanToOrder({ orderNo, code: p.barcode }, admin),
    ]);
    expect(await stock(p.id)).toBe("2");
    const order = await db.salesOrder.findUniqueOrThrow({
      where: { orderNo },
      include: { items: true },
    });
    expect(order.items[0].quantity.toString()).toBe("3");

    await expect(
      orders.updateOrder(
        { id: order.id, orderNo, items: [{ productId: p.id, quantity: "9" }] },
        admin,
      ),
    ).rejects.toThrow(/Not enough stock/);
    expect(await stock(p.id)).toBe("2");

    const renamed = `${orderNo}9`;
    await orders.updateOrder(
      { id: order.id, orderNo: renamed, items: [{ productId: p.id, quantity: "1" }] },
      admin,
    );
    expect(await stock(p.id)).toBe("4");
    const recent = await workspace(admin);
    expect(recent.orders.some((o) => o.orderNo === renamed)).toBe(true);

    await orders.deleteOrder({ id: order.id }, admin);
    expect(await stock(p.id)).toBe("5");
    expect(await db.salesOrder.findUnique({ where: { id: order.id } })).toBeNull();
    const ledger = await db.stockMovement.aggregate({
      where: { productId: p.id },
      _sum: { quantity: true },
    });
    expect(ledger._sum.quantity?.toString()).toBe("5");
  });

  it("rejects unknown team codes and unknown products", async () => {
    const { p, orderNo } = await fixture();
    await expect(
      orders.scanToOrder({ orderNo: "QQQQQQQQQQ1", code: p.barcode }, admin),
    ).rejects.toThrow(/No team member/);
    await expect(
      orders.scanToOrder({ orderNo, code: "no-such-barcode" }, admin),
    ).rejects.toThrow(/No product found/);
  });

  it("deletes team members only when they have no orders", async () => {
    const { code, p, orderNo } = await fixture();
    const member = await db.teamMember.findUniqueOrThrow({ where: { code } });
    await orders.scanToOrder({ orderNo, code: p.barcode }, admin);
    await expect(
      orders.deleteTeamMember({ id: member.id }, admin),
    ).rejects.toThrow(/cannot be deleted/);
    const order = await db.salesOrder.findUniqueOrThrow({ where: { orderNo } });
    await orders.deleteOrder({ id: order.id }, admin);
    await orders.deleteTeamMember({ id: member.id }, admin);
    expect(await db.teamMember.findUnique({ where: { id: member.id } })).toBeNull();
  });

  it("returns stock on Returned, takes it again on reopen, and searches by ID", async () => {
    const { p, orderNo } = await fixture();
    await orders.scanToOrder({ orderNo, code: p.barcode }, admin);
    await orders.scanToOrder({ orderNo, code: p.barcode }, admin);
    expect(await stock(p.id)).toBe("3");
    const order = await db.salesOrder.findUniqueOrThrow({ where: { orderNo } });

    await orders.setOrderStatus({ id: order.id, status: "DISPATCHED" }, admin);
    expect(await stock(p.id)).toBe("3");
    await orders.setOrderStatus(
      { id: order.id, status: "RETURNED", note: "Customer refused" },
      admin,
    );
    expect(await stock(p.id)).toBe("5");
    await expect(
      orders.scanToOrder({ orderNo, code: p.barcode }, admin),
    ).rejects.toThrow(/Returned/);
    await expect(
      orders.updateOrder(
        { id: order.id, orderNo, items: [{ productId: p.id, quantity: "1" }] },
        admin,
      ),
    ).rejects.toThrow(/Returned/);

    const found = await orders.searchOrders(
      { q: orderNo.slice(0, -2), status: "RETURNED" },
      admin,
    );
    expect(found.some((o) => o.id === order.id)).toBe(true);

    await orders.setOrderStatus({ id: order.id, status: "PLACED" }, admin);
    expect(await stock(p.id)).toBe("3");
    await orders.setOrderStatus({ id: order.id, status: "CANCELLED" }, admin);
    expect(await stock(p.id)).toBe("5");
    // Deleting a cancelled order must not add its stock a second time.
    await orders.deleteOrder({ id: order.id }, admin);
    expect(await stock(p.id)).toBe("5");
    const ledger = await db.stockMovement.aggregate({
      where: { productId: p.id },
      _sum: { quantity: true },
    });
    expect(ledger._sum.quantity?.toString()).toBe("5");
  });

  it("moves stock to damaged on Damaged and back out on other statuses", async () => {
    const { p, orderNo } = await fixture();
    const damaged = async () =>
      (await db.product.findUniqueOrThrow({ where: { id: p.id } })).damaged.toString();
    await orders.scanToOrder({ orderNo, code: p.barcode, quantity: "2" }, admin);
    const order = await db.salesOrder.findUniqueOrThrow({ where: { orderNo } });

    await orders.setOrderStatus({ id: order.id, status: "DAMAGED" }, admin);
    expect([await stock(p.id), await damaged()]).toEqual(["3", "2"]);
    await expect(orders.deleteOrder({ id: order.id }, admin)).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      orders.scanToOrder({ orderNo, code: p.barcode }, admin),
    ).rejects.toThrow(/Damaged/);

    await orders.setOrderStatus({ id: order.id, status: "RETURNED" }, admin);
    expect([await stock(p.id), await damaged()]).toEqual(["5", "0"]);
    await orders.setOrderStatus({ id: order.id, status: "DAMAGED" }, admin);
    await orders.setOrderStatus({ id: order.id, status: "DELIVERED" }, admin);
    expect([await stock(p.id), await damaged()]).toEqual(["3", "0"]);

    const listed = await orders.listOrders({ q: orderNo, status: "DELIVERED" }, admin);
    expect(listed.total).toBe(1);
    expect(listed.counts.DELIVERED).toBe(1);

    await orders.deleteOrder({ id: order.id }, admin);
    const ledger = await db.stockMovement.groupBy({
      by: ["bucket"],
      where: { productId: p.id },
      _sum: { quantity: true },
    });
    expect(
      Object.fromEntries(ledger.map((l) => [l.bucket, l._sum.quantity?.toString()])),
    ).toEqual({ SELLABLE: "5", DAMAGED: "0" });
  });

  it("adds many pieces in one scan and blocks more than stock", async () => {
    const { p, orderNo } = await fixture();
    await orders.scanToOrder({ orderNo, code: p.barcode, quantity: "4" }, admin);
    expect(await stock(p.id)).toBe("1");
    await expect(
      orders.scanToOrder({ orderNo, code: p.barcode, quantity: "2" }, admin),
    ).rejects.toThrow(/Not enough stock/);
    const order = await db.salesOrder.findUniqueOrThrow({
      where: { orderNo },
      include: { items: true },
    });
    expect(order.items[0].quantity.toString()).toBe("4");
    await orders.deleteOrder({ id: order.id }, admin);
    expect(await stock(p.id)).toBe("5");
  });
});
