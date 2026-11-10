import { afterAll, describe, it, expect } from "vitest";
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
const { executeQuantity: execute } = await import("../src/lib/quantity");
const { workspace } = await import("../src/lib/workspace");
const admin = { id: "quantity-admin", role: "ADMIN" };
const row = (id: string, quantity: string, extra = {}) => ({
  productId: id,
  quantity,
  ...extra,
});
const op = (type: string, items: unknown[], extra = {}) => ({
  requestKey: randomUUID(),
  type,
  items,
  notes: "Validation operation",
  ...extra,
});
async function fixture() {
  const suffix = randomUUID();
  const branch = await db.user.create({
    data: {
      email: `${suffix}@branch.invalid`,
      passwordHash: "unused-test-only",
      role: "BRANCH_MANAGER",
    },
  });
  const manufacturer = await db.user.create({
    data: {
      email: `${suffix}@factory.invalid`,
      passwordHash: "unused-test-only",
      role: "MANUFACTURER",
    },
  });
  const p = await db.product.create({
    data: {
      name: suffix,
      barcode: suffix,
      purchasePrice: "80",
      sellingPrice: "120",
    },
  });
  const other = await db.product.create({
    data: {
      name: `${suffix}-private`,
      purchasePrice: "10",
      sellingPrice: "20",
    },
  });
  await execute(op("STOCK_IN", [row(p.id, "20"), row(other.id, "50")]), admin);
  return { branch, manufacturer, p, other };
}
describe.skipIf(!enabled)(
  "quantity locations and manufacturing on MySQL",
  () => {
    afterAll(() => db.$disconnect());
    it("transfers stock once, isolates branch inventory and enforces admin sales/returns", async () => {
      const { branch, p, other } = await fixture();
      const input = op("ASSIGN", [row(p.id, "7")], { ownerId: branch.id });
      const [a, b] = await Promise.all([
        execute(input, admin),
        execute(input, admin),
      ]);
      expect(a.id).toBe(b.id);
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: p.id } })
        ).stock.toString(),
      ).toBe("13");
      const scoped = await workspace(branch);
      expect(scoped.products.map((p) => p.id)).toEqual([p.id]);
      expect(scoped.products[0].stock?.toString()).toBe("7");
      expect(JSON.stringify(scoped)).not.toMatch(
        /purchasePrice|sellingPrice|averageCost|passwordHash/,
      );
      expect(scoped.products.some((p) => p.id === other.id)).toBe(false);
      expect(scoped.suppliers).toEqual([]);
      expect(scoped.users).toEqual([]);
      await expect(
        execute(op("SALE", [row(p.id, "1")]), branch),
      ).rejects.toThrow("role");
      const sale = await execute(
        op("SALE", [row(p.id, "2")], { ownerId: branch.id }),
        branch,
      );
      await execute(
        op("RETURN", [row(p.id, "1")], {
          ownerId: branch.id,
          sourceId: sale.id,
        }),
        admin,
      );
      await expect(
        execute(
          op("RETURN", [row(p.id, "2")], {
            ownerId: branch.id,
            sourceId: sale.id,
          }),
          admin,
        ),
      ).rejects.toThrow("remaining");
      await expect(
        execute(op("RETURN", [row(p.id, "1")], { sourceId: sale.id }), admin),
      ).rejects.toThrow("location");
      await execute(
        op("BRANCH_RETURN", [row(p.id, "3")], { ownerId: branch.id }),
        admin,
      );
      expect((await workspace(branch)).products[0].stock?.toString()).toBe("3");
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: p.id } })
        ).stock.toString(),
      ).toBe("16");
      await expect(
        execute({ ...input, items: [row(p.id, "8")] }, admin),
      ).rejects.toThrow("different");
    });
    it("calculates packed pieces, holds dispatch in transit and prevents duplicate or excess receiving", async () => {
      const { manufacturer, p } = await fixture();
      const pack = { boxes: 2, piecesPerBox: 12, loosePieces: 3 };
      await execute(
        op("READY", [row(p.id, "27", pack)], { ownerId: manufacturer.id }),
        manufacturer,
      );
      const scoped = await workspace(manufacturer);
      expect(JSON.stringify(scoped.products)).not.toMatch(
        /purchasePrice|averageCost|minStock/,
      );
      expect(scoped.products.find((i) => i.id === p.id)?.stock).toBeUndefined();
      expect(JSON.stringify(scoped.products)).not.toContain('"stock"');
      expect(scoped.balances).toEqual([]);
      expect(scoped.events).toEqual([]);
      await expect(
        execute(
          op("READY", [row(p.id, "28", pack)], { ownerId: manufacturer.id }),
          manufacturer,
        ),
      ).rejects.toThrow("must equal");
      await expect(
        execute(
          op("DISPATCH", [row(p.id, "28", { loosePieces: 28 })], {
            ownerId: manufacturer.id,
          }),
          manufacturer,
        ),
      ).rejects.toThrow("Insufficient");
      const dispatch = await execute(
        op(
          "DISPATCH",
          [row(p.id, "15", { boxes: 1, piecesPerBox: 12, loosePieces: 3 })],
          { ownerId: manufacturer.id },
        ),
        manufacturer,
      );
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: p.id } })
        ).stock.toString(),
      ).toBe("20");
      const receipt = op("RECEIVE", [row(p.id, "10")], {
        sourceId: dispatch.id,
      });
      const [a, b] = await Promise.all([
        execute(receipt, admin),
        execute(receipt, admin),
      ]);
      expect(a.id).toBe(b.id);
      await expect(
        execute(
          op("RECEIVE", [row(p.id, "6")], { sourceId: dispatch.id }),
          admin,
        ),
      ).rejects.toThrow("remaining");
      await execute(
        op("RECEIVE", [row(p.id, "5")], { sourceId: dispatch.id }),
        admin,
      );
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: p.id } })
        ).stock.toString(),
      ).toBe("35");
      const manufacturerWorkspace = await workspace(manufacturer);
      expect(
        manufacturerWorkspace.products.find((i) => i.id === p.id)?.stock,
      ).toBeUndefined();
      expect(JSON.stringify(manufacturerWorkspace.products)).not.toContain(
        '"stock"',
      );
      expect(manufacturerWorkspace.balances).toEqual([]);
      expect(manufacturerWorkspace.events).toEqual([]);
      expect(
        (
          await db.locationBalance.findUniqueOrThrow({
            where: {
              ownerId_productId: {
                ownerId: manufacturer.id,
                productId: p.id,
              },
            },
          })
        ).quantity.toString(),
      ).toBe("12");
    });
    it("sends sellable and damaged stock back to a manufacturer and shows it only to them", async () => {
      const { branch, manufacturer, p } = await fixture();
      const buckets = async () => {
        const row = await db.product.findUniqueOrThrow({ where: { id: p.id } });
        return [row.stock.toString(), row.damaged.toString()];
      };
      await execute(op("DAMAGED", [row(p.id, "4")]), admin);
      expect(await buckets()).toEqual(["16", "4"]);
      await execute(
        op("MFG_RETURN", [row(p.id, "3")], {
          ownerId: manufacturer.id,
          condition: "DAMAGED",
        }),
        admin,
      );
      await execute(
        op("MFG_RETURN", [row(p.id, "6")], { ownerId: manufacturer.id }),
        admin,
      );
      expect(await buckets()).toEqual(["10", "1"]);
      await expect(
        execute(
          op("MFG_RETURN", [row(p.id, "2")], {
            ownerId: manufacturer.id,
            condition: "DAMAGED",
          }),
          admin,
        ),
      ).rejects.toThrow("Insufficient");
      await expect(
        execute(op("MFG_RETURN", [row(p.id, "1")], { ownerId: branch.id }), admin),
      ).rejects.toThrow("manufacturer");
      await expect(
        execute(
          op("MFG_RETURN", [row(p.id, "1")], { ownerId: manufacturer.id }),
          manufacturer,
        ),
      ).rejects.toThrow("role");
      const scoped = await workspace(manufacturer);
      expect(scoped.events.map((e) => [e.type, e.condition])).toEqual([
        ["MFG_RETURN", "SELLABLE"],
        ["MFG_RETURN", "DAMAGED"],
      ]);
      expect(scoped.balances).toEqual([]);
      expect((await workspace(branch)).events).toEqual([]);
    });
    it("rolls back whole batches and prevents concurrent negative balances", async () => {
      const { branch, p, other } = await fixture();
      const input = op("ASSIGN", [row(p.id, "3"), row(other.id, "51")], {
        ownerId: branch.id,
      });
      await expect(execute(input, admin)).rejects.toThrow("Insufficient");
      expect(
        await db.quantityEvent.findUnique({
          where: { requestKey: input.requestKey },
        }),
      ).toBeNull();
      expect((await workspace(branch)).products).toHaveLength(0);
      const results = await Promise.allSettled([
        execute(op("ASSIGN", [row(p.id, "15")], { ownerId: branch.id }), admin),
        execute(op("SALE", [row(p.id, "15")]), admin),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: p.id } })
        ).stock.toString(),
      ).toBe("5");
      const sum = await db.stockMovement.aggregate({
        where: { productId: p.id },
        _sum: { quantity: true },
      });
      expect(sum._sum.quantity?.toString()).toBe("5");
    });
    it("preserves damaged, expired and quarantined bucket ledgers", async () => {
      const { p } = await fixture();
      await execute(op("QUARANTINED", [row(p.id, "5")]), admin);
      await execute(op("RELEASE", [row(p.id, "2")]), admin);
      await execute(op("DISPOSE_QUARANTINED", [row(p.id, "1")]), admin);
      await expect(
        execute(op("DISPOSE_QUARANTINED", [row(p.id, "3")]), admin),
      ).rejects.toThrow("Insufficient");
      const product = await db.product.findUniqueOrThrow({
        where: { id: p.id },
      });
      expect(product.stock.toString()).toBe("17");
      expect(product.quarantined.toString()).toBe("2");
    });
    it("keeps damaged branch returns out of sellable stock and blocks unrelated returns", async () => {
      const { branch, p, other } = await fixture();
      await execute(
        op("ASSIGN", [row(p.id, "5")], { ownerId: branch.id }),
        admin,
      );
      const sale = await execute(
        op("SALE", [row(p.id, "2")], { ownerId: branch.id }),
        branch,
      );
      await execute(
        op("RETURN", [row(p.id, "1")], {
          ownerId: branch.id,
          sourceId: sale.id,
          condition: "DAMAGED",
        }),
        branch,
      );
      await execute(
        op("EXPIRED", [row(p.id, "1")], { ownerId: branch.id }),
        branch,
      );
      const scoped = await workspace(branch);
      expect(scoped.products[0].stock?.toString()).toBe("2");
      expect(scoped.products[0].damaged?.toString()).toBe("1");
      expect(scoped.products[0].expired?.toString()).toBe("1");
      await execute(
        op("DISPOSE_EXPIRED", [row(p.id, "1")], { ownerId: branch.id }),
        admin,
      );
      expect((await workspace(branch)).products[0].expired?.toString()).toBe(
        "0",
      );
      await expect(
        execute(
          op("DISPOSE_DAMAGED", [row(p.id, "1")], { ownerId: branch.id }),
          branch,
        ),
      ).rejects.toThrow("role");
      await expect(
        execute(
          op("RETURN", [row(other.id, "1")], {
            ownerId: branch.id,
            sourceId: sale.id,
          }),
          branch,
        ),
      ).rejects.toThrow("not assigned");
      await expect(
        execute(op("SALE", [row(p.id, "3")], { ownerId: branch.id }), branch),
      ).rejects.toThrow("Insufficient");
      expect(
        (
          await db.product.findUniqueOrThrow({ where: { id: p.id } })
        ).stock.toString(),
      ).toBe("15");
    });
  },
);
