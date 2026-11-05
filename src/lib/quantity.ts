import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { db } from "./db";
import { D } from "./math";
import { InventoryError } from "./errors";
import { quantity } from "./validation";

export const CENTRAL = "CENTRAL";
export const quantitySchema = z.object({
  requestKey: z.string().uuid(),
  type: z.enum([
    "ASSIGN",
    "BRANCH_RETURN",
    "READY",
    "DISPATCH",
    "RECEIVE",
    "SALE",
    "RETURN",
    "STOCK_IN",
    "LOSS",
    "DAMAGED",
    "EXPIRED",
    "QUARANTINED",
    "RELEASE",
    "DISPOSE_DAMAGED",
    "DISPOSE_EXPIRED",
    "DISPOSE_QUARANTINED",
  ]),
  ownerId: z.string().min(1).max(191).default(CENTRAL),
  sourceId: z.string().max(191).optional(),
  condition: z
    .enum(["SELLABLE", "DAMAGED", "EXPIRED", "QUARANTINED"])
    .default("SELLABLE"),
  notes: z.string().trim().min(5).max(2000),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(191),
        quantity,
        boxes: z.number().int().min(0).max(999999).default(0),
        piecesPerBox: z.number().int().min(1).max(999999).default(1),
        loosePieces: z.number().int().min(0).max(999999).default(0),
      }),
    )
    .min(1)
    .max(200),
});
export type QuantityInput = z.infer<typeof quantitySchema>;
export type Actor = { id: string; role: string; email?: string };
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new InventoryError(message);
}
export function authorizeQuantity(user: Actor, input: QuantityInput) {
  if (
    user.role === "ADMIN" &&
    input.type !== "READY" &&
    input.type !== "DISPATCH"
  )
    return;
  if (
    user.role === "BRANCH_MANAGER" &&
    input.ownerId === user.id &&
    ["SALE", "RETURN", "LOSS", "DAMAGED", "EXPIRED", "QUARANTINED"].includes(
      input.type,
    )
  )
    return;
  if (
    user.role === "MANUFACTURER" &&
    ["READY", "DISPATCH"].includes(input.type) &&
    input.ownerId === user.id
  )
    return;
  throw new InventoryError("This operation is not allowed for your role");
}
export function packedPieces(boxes: number, size: number, loose: number) {
  const n = D(boxes).mul(size).plus(loose);
  ensure(
    n.gt(0) && n.lte(999999999),
    "Enter boxes/pieces totalling 1 to 999999999 pieces",
  );
  return n.toString();
}
export async function executeQuantity(raw: unknown, user: Actor) {
  const input = quantitySchema.parse(raw);
  authorizeQuantity(user, input);
  ensure(
    new Set(input.items.map((i) => i.productId)).size === input.items.length,
    "Combine duplicate products in one row",
  );
  if (["READY", "DISPATCH"].includes(input.type))
    for (const i of input.items)
      ensure(
        packedPieces(i.boxes, i.piecesPerBox, i.loosePieces) ===
          D(i.quantity).toString(),
        "Quantity must equal boxes × pieces per box + loose pieces",
      );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ user: user.id, input }))
    .digest("hex");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const cached = await tx.quantityEvent.findUnique({
            where: { requestKey: input.requestKey },
          });
          if (cached) {
            ensure(
              cached.fingerprint === fingerprint,
              "Request key already used for different data",
            );
            return { id: cached.id };
          }
          // Product locks serialize central and all location balance changes for a product.
          for (const id of input.items.map((i) => i.productId).sort())
            await tx.$queryRaw`SELECT id FROM Product WHERE id = ${id} FOR UPDATE`;
          if (
            ["ASSIGN", "BRANCH_RETURN"].includes(input.type) ||
            ([
              "SALE",
              "RETURN",
              "LOSS",
              "DAMAGED",
              "EXPIRED",
              "QUARANTINED",
              "RELEASE",
              "DISPOSE_DAMAGED",
              "DISPOSE_EXPIRED",
              "DISPOSE_QUARANTINED",
            ].includes(input.type) &&
              input.ownerId !== CENTRAL)
          ) {
            const owner = await tx.user.findUnique({
              where: { id: input.ownerId },
            });
            ensure(
              owner?.active && owner.role === "BRANCH_MANAGER",
              "Choose an active branch manager",
            );
          } else if (!["READY", "DISPATCH", "RECEIVE"].includes(input.type)) {
            ensure(
              input.ownerId === CENTRAL,
              "This operation is available for central inventory only",
            );
          }
          let source: Awaited<
            ReturnType<typeof tx.quantityEvent.findUnique>
          > | null = null;
          if (["RECEIVE", "RETURN"].includes(input.type)) {
            ensure(input.sourceId, "Select the original dispatch or sale");
            await tx.$queryRaw`SELECT id FROM QuantityEvent WHERE id = ${input.sourceId} FOR UPDATE`;
            source = await tx.quantityEvent.findUnique({
              where: { id: input.sourceId },
            });
            ensure(
              source &&
                source.type ===
                  (input.type === "RECEIVE" ? "DISPATCH" : "SALE"),
              "Original record not found",
            );
            ensure(
              input.type !== "RETURN" || source.ownerId === input.ownerId,
              "Return must use the original sale location",
            );
            ensure(
              input.type !== "RECEIVE" || input.ownerId === CENTRAL,
              "Dispatches must be received into central inventory",
            );
          }
          const event = await tx.quantityEvent.create({
            data: {
              requestKey: input.requestKey,
              fingerprint,
              type: input.type,
              condition: input.condition,
              actorId: user.id,
              ownerId: input.ownerId,
              sourceId: input.sourceId,
              notes: input.notes,
            },
          });
          for (const line of input.items) {
            if (user.role === "BRANCH_MANAGER") {
              const assigned = await tx.locationBalance.findUnique({
                where: {
                  ownerId_productId: {
                    ownerId: user.id,
                    productId: line.productId,
                  },
                },
              });
              ensure(assigned, "Product is not assigned to your branch");
            }
            const product = await tx.product.findUnique({
              where: { id: line.productId },
            });
            ensure(product, "Product not found");
            ensure(
              product.active ||
                [
                  "RETURN",
                  "BRANCH_RETURN",
                  "RECEIVE",
                  "DISPOSE_DAMAGED",
                  "DISPOSE_EXPIRED",
                  "DISPOSE_QUARANTINED",
                ].includes(input.type),
              "Product is archived",
            );
            if (["READY", "DISPATCH"].includes(input.type))
              ensure(
                ["pcs", "piece", "pieces"].includes(product.unit.toLowerCase()),
                "Manufacturing requires a product measured in pieces (pcs)",
              );
            const qty = D(line.quantity);
            const location = async (
              ownerId: string,
              direction: 1 | -1,
              bucket:
                "quantity" | "damaged" | "expired" | "quarantined" = "quantity",
            ) => {
              await tx.locationBalance.upsert({
                where: {
                  ownerId_productId: { ownerId, productId: product.id },
                },
                create: { ownerId, productId: product.id, quantity: "0" },
                update: {},
              });
              const changed = await tx.locationBalance.updateMany({
                where: {
                  ownerId,
                  productId: product.id,
                  ...(direction < 0
                    ? { [bucket]: { gte: line.quantity } }
                    : {}),
                },
                data: {
                  [bucket]: { increment: qty.mul(direction).toString() },
                },
              });
              ensure(
                changed.count === 1,
                `Insufficient assigned/ready stock: ${product.name}`,
              );
            };
            const central = async (
              direction: 1 | -1,
              bucket: "stock" | "damaged" | "expired" | "quarantined" = "stock",
            ) => {
              const changed = await tx.product.updateMany({
                where: {
                  id: product.id,
                  ...(direction < 0
                    ? { [bucket]: { gte: line.quantity } }
                    : {}),
                },
                data: {
                  [bucket]: { increment: qty.mul(direction).toString() },
                },
              });
              ensure(
                changed.count === 1,
                `Insufficient ${bucket} stock: ${product.name}`,
              );
              await tx.stockMovement.create({
                data: {
                  productId: product.id,
                  type: input.type,
                  bucket:
                    bucket === "stock" ? "SELLABLE" : bucket.toUpperCase(),
                  quantity: qty.mul(direction).toString(),
                  unitCost: product.averageCost,
                  reference: event.id,
                  reason: input.notes,
                },
              });
            };
            if (source) {
              const original = await tx.quantityLine.findFirst({
                where: { eventId: source.id, productId: product.id },
              });
              ensure(
                original &&
                  D(original.quantity).minus(original.processed).gte(qty),
                `Quantity exceeds remaining original quantity: ${product.name}`,
              );
              await tx.quantityLine.update({
                where: { id: original.id },
                data: { processed: { increment: line.quantity } },
              });
            }
            switch (input.type) {
              case "ASSIGN":
                await central(-1);
                await location(input.ownerId, 1);
                break;
              case "BRANCH_RETURN":
                await location(input.ownerId, -1);
                await central(1);
                break;
              case "READY":
                await location(user.id, 1);
                break;
              case "DISPATCH":
                await location(user.id, -1);
                break;
              case "RECEIVE":
              case "STOCK_IN":
                await central(1);
                break;
              case "SALE":
              case "LOSS":
                if (input.ownerId === CENTRAL) await central(-1);
                else await location(input.ownerId, -1);
                break;
              case "RETURN": {
                const bucket =
                  input.condition === "SELLABLE"
                    ? "stock"
                    : (input.condition.toLowerCase() as
                        "damaged" | "expired" | "quarantined");
                if (input.ownerId === CENTRAL) await central(1, bucket);
                else
                  await location(
                    input.ownerId,
                    1,
                    bucket === "stock" ? "quantity" : bucket,
                  );
                break;
              }
              case "DAMAGED":
              case "EXPIRED":
              case "QUARANTINED":
                if (input.ownerId === CENTRAL) {
                  await central(-1);
                  await central(
                    1,
                    input.type.toLowerCase() as
                      "damaged" | "expired" | "quarantined",
                  );
                } else {
                  await location(input.ownerId, -1);
                  await location(
                    input.ownerId,
                    1,
                    input.type.toLowerCase() as
                      "damaged" | "expired" | "quarantined",
                  );
                }
                break;
              case "RELEASE":
                if (input.ownerId === CENTRAL) {
                  await central(-1, "quarantined");
                  await central(1);
                } else {
                  await location(input.ownerId, -1, "quarantined");
                  await location(input.ownerId, 1);
                }
                break;
              case "DISPOSE_DAMAGED":
                if (input.ownerId === CENTRAL) await central(-1, "damaged");
                else await location(input.ownerId, -1, "damaged");
                break;
              case "DISPOSE_EXPIRED":
                if (input.ownerId === CENTRAL) await central(-1, "expired");
                else await location(input.ownerId, -1, "expired");
                break;
              case "DISPOSE_QUARANTINED":
                if (input.ownerId === CENTRAL) await central(-1, "quarantined");
                else await location(input.ownerId, -1, "quarantined");
                break;
            }
            await tx.quantityLine.create({
              data: { eventId: event.id, ...line },
            });
          }
          await tx.auditLog.create({
            data: {
              action: input.type,
              actorId: user.id,
              reference: event.id,
              detail: JSON.stringify({
                ownerId: input.ownerId,
                lines: input.items.length,
                sourceId: input.sourceId,
              }),
            },
          });
          return { id: event.id };
        },
        { isolationLevel: "Serializable", timeout: 60000, maxWait: 10000 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (["P2034", "P2002"].includes(e.code) ||
          (e.code === "P2010" &&
            ["1213", "1205"].includes(String(e.meta?.code)))) &&
        attempt < 2
      )
        continue;
      throw e;
    }
  }
  throw new InventoryError("Please retry the operation");
}
