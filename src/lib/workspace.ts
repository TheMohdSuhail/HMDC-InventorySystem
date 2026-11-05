import { db } from "./db";
import { CENTRAL, type Actor } from "./quantity";
import { InventoryError } from "./errors";

export const catalogSelect = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  category: true,
  expiryDate: true,
  unit: true,
  active: true,
} as const;
export async function workspace(user: Actor) {
  if (!["ADMIN", "BRANCH_MANAGER", "MANUFACTURER", "USER"].includes(user.role))
    throw new InventoryError("Unknown role");
  const admin = user.role === "ADMIN";
  const manufacturer = user.role === "MANUFACTURER";
  return db.$transaction(
    async (tx) => {
      const balances = manufacturer
        ? []
        : await tx.locationBalance.findMany({
            where: admin ? {} : { ownerId: user.id },
          });
      const products = await tx.product.findMany({
        where:
          admin || manufacturer
            ? {}
            : { id: { in: balances.map((b) => b.productId) } },
        select: {
          ...catalogSelect,
          ...(admin
            ? {
                stock: true,
                damaged: true,
                expired: true,
                quarantined: true,
                minStock: true,
                notes: true,
              }
            : {}),
        },
        orderBy: { name: "asc" },
      });
      const events = manufacturer
        ? []
        : await tx.quantityEvent.findMany({
            where: admin ? {} : { ownerId: user.id },
            include: { items: true },
            orderBy: { createdAt: "desc" },
          });
      // Fingerprints, other actors, and internal identifiers are unnecessary in member responses.
      const history = events.map((e) => ({
        id: e.id,
        type: e.type,
        condition: e.condition,
        actorId: e.actorId,
        ownerId: e.ownerId,
        sourceId: e.sourceId,
        notes: e.notes,
        createdAt: e.createdAt,
        items: e.items,
      }));
      const users = admin
        ? await tx.user.findMany({
            select: { id: true, email: true, role: true, active: true },
            orderBy: { email: "asc" },
          })
        : [];
      const settings = await tx.settings.findUnique({
        where: { id: 1 },
        select: { name: true, minStock: true, dateFormat: true },
      });
      return {
        user: { id: user.id, email: user.email || "", role: user.role },
        central: CENTRAL,
        products: products.map((p) => {
          const hasCentralStock = "stock" in p;
          const balance = balances.find((b) => b.productId === p.id);
          return {
            ...p,
            damaged: hasCentralStock
              ? p.damaged
              : manufacturer
                ? undefined
                : (balance?.damaged ?? "0"),
            expired: hasCentralStock
              ? p.expired
              : manufacturer
                ? undefined
                : (balance?.expired ?? "0"),
            quarantined: hasCentralStock
              ? p.quarantined
              : manufacturer
                ? undefined
                : (balance?.quarantined ?? "0"),
            stock: hasCentralStock
              ? p.stock
              : manufacturer
                ? undefined
                : (balance?.quantity ?? "0"),
            minStock: hasCentralStock ? p.minStock : undefined,
            notes: hasCentralStock ? p.notes : undefined,
          };
        }),
        balances,
        events: history,
        users,
        settings: settings ?? {
          name: "Herbal Maza",
          minStock: "5",
          dateFormat: "dd/MM/yyyy",
        },
        suppliers: admin ? await tx.supplier.findMany() : [],
        purchases: admin
          ? await tx.purchaseOrder.findMany({
              select: {
                id: true,
                number: true,
                supplierId: true,
                status: true,
                items: {
                  select: {
                    id: true,
                    productId: true,
                    quantity: true,
                    received: true,
                  },
                },
              },
            })
          : [],
        legacySales: admin
          ? await tx.sale.findMany({
              select: {
                id: true,
                number: true,
                status: true,
                customer: true,
                createdAt: true,
                items: {
                  select: {
                    id: true,
                    productId: true,
                    quantity: true,
                    returned: true,
                  },
                },
              },
              orderBy: { createdAt: "desc" },
            })
          : [],
        legacyReturns: admin
          ? await tx.salesReturn.findMany({
              select: {
                id: true,
                number: true,
                reason: true,
                createdAt: true,
                items: {
                  select: { productId: true, quantity: true, condition: true },
                },
              },
            })
          : [],
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export type Workspace = Awaited<ReturnType<typeof workspace>>;
