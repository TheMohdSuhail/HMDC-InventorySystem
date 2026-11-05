import { PrismaClient } from "@prisma/client";
import { D } from "../src/lib/math";
const db = new PrismaClient();
async function main() {
  const result = await db.$transaction(
    async (tx) => {
      const [products, movements, admins] = await Promise.all([
        tx.product.findMany(),
        tx.stockMovement.groupBy({
          by: ["productId", "bucket"],
          _sum: { quantity: true },
        }),
        tx.user.count({ where: { role: "ADMIN", active: true } }),
      ]);
      const fields = {
        SELLABLE: "stock",
        DAMAGED: "damaged",
        EXPIRED: "expired",
        QUARANTINED: "quarantined",
      } as const;
      const mismatches: string[] = [];
      for (const p of products)
        for (const [bucket, field] of Object.entries(fields)) {
          const quantity =
            movements.find((m) => m.productId === p.id && m.bucket === bucket)
              ?._sum.quantity ?? "0";
          if (!D(p[field]).eq(quantity.toString()))
            mismatches.push(`${p.id}: ${bucket} balance differs from ledger`);
        }
      const balances = await tx.locationBalance.findMany();
      const events = await tx.quantityEvent.findMany({
        where: { ownerId: { not: "CENTRAL" } },
        include: { items: true },
      });
      const expected = new Map<string, ReturnType<typeof D>>();
      const add = (
        ownerId: string,
        productId: string,
        bucket: string,
        quantity: string,
      ) => {
        const key = `${ownerId}|${productId}|${bucket}`;
        expected.set(key, (expected.get(key) ?? D(0)).plus(quantity));
      };
      for (const event of events)
        for (const item of event.items) {
          const bucket =
            event.type === "RETURN"
              ? event.condition.toLowerCase()
              : "quantity";
          if (["ASSIGN", "READY", "RETURN"].includes(event.type))
            add(
              event.ownerId,
              item.productId,
              bucket === "sellable" ? "quantity" : bucket,
              item.quantity.toString(),
            );
          if (
            [
              "BRANCH_RETURN",
              "SALE",
              "LOSS",
              "DISPATCH",
              "DAMAGED",
              "EXPIRED",
              "QUARANTINED",
            ].includes(event.type)
          )
            add(
              event.ownerId,
              item.productId,
              "quantity",
              D(item.quantity).neg().toString(),
            );
          if (["DAMAGED", "EXPIRED", "QUARANTINED"].includes(event.type))
            add(
              event.ownerId,
              item.productId,
              event.type.toLowerCase(),
              item.quantity.toString(),
            );
        }
      for (const event of events)
        for (const item of event.items) {
          if (event.type === "RELEASE") {
            add(
              event.ownerId,
              item.productId,
              "quarantined",
              D(item.quantity).neg().toString(),
            );
            add(
              event.ownerId,
              item.productId,
              "quantity",
              item.quantity.toString(),
            );
          }
          if (event.type.startsWith("DISPOSE_"))
            add(
              event.ownerId,
              item.productId,
              event.type.slice(8).toLowerCase(),
              D(item.quantity).neg().toString(),
            );
        }
      for (const balance of balances)
        for (const bucket of [
          "quantity",
          "damaged",
          "expired",
          "quarantined",
        ] as const) {
          const key = `${balance.ownerId}|${balance.productId}|${bucket}`;
          if (!D(balance[bucket]).eq(expected.get(key) ?? D(0)))
            mismatches.push(`${key}: location balance differs from events`);
          expected.delete(key);
        }
      for (const [key, value] of expected)
        if (!value.isZero())
          mismatches.push(`${key}: location balance missing`);
      return {
        products: products.length,
        activeAdmins: admins,
        locationBalances: balances.length,
        bucketMismatches: mismatches,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.bucketMismatches.length) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error(
      "Database integrity check unavailable; verify connection and schema",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
