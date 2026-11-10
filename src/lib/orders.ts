import { z } from "zod";
import { Prisma } from "@prisma/client";
import type Decimal from "decimal.js";
import { db } from "./db";
import { D } from "./math";
import { InventoryError } from "./errors";
import { quantity } from "./validation";
import { CENTRAL, type Actor } from "./quantity";
import {
  OPEN_STATUSES,
  ORDER_STATUSES,
  STATUS_LABELS,
  TEAM_CODE,
  normalizeOrderNo,
  normalizeTeamCode,
  orderPrefix,
  statusBucket,
} from "./order-id";

type Tx = Prisma.TransactionClient;

function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new InventoryError(message);
}

export const orderInclude = {
  teamMember: { select: { id: true, name: true, code: true } },
  items: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.SalesOrderInclude;

const orderNoSchema = z
  .string()
  .max(64)
  .transform(normalizeOrderNo)
  .refine((v) => !!orderPrefix(v), "Order ID must be a team code followed by numbers, e.g. TRL1023");

export const scanSchema = z.object({
  orderNo: orderNoSchema,
  ownerId: z.string().min(1).max(191).default(CENTRAL),
  code: z.string().trim().min(1).max(191),
  // Pieces added by this scan (default one).
  quantity: quantity.default("1"),
});
export const updateSchema = z.object({
  id: z.string().min(1).max(64),
  orderNo: orderNoSchema,
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(191),
        // "0" removes the line.
        quantity: z.union([quantity, z.literal("0")]),
      }),
    )
    .max(200),
});
export const deleteSchema = z.object({ id: z.string().min(1).max(64) });
export const teamSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(191),
  code: z
    .string()
    .transform(normalizeTeamCode)
    .refine((v) => TEAM_CODE.test(v), "Code must be 1 to 10 letters, e.g. TRL"),
  phone: z.string().trim().max(64).optional().default(""),
  active: z.boolean().default(true),
});

function canSell(user: Actor) {
  ensure(
    user.role === "ADMIN" || user.role === "BRANCH_MANAGER",
    "Sales are not available for your role",
  );
}

function canAccess(user: Actor, ownerId: string) {
  ensure(
    user.role === "ADMIN" || ownerId === user.id,
    "This order belongs to another location",
  );
}

async function teamFor(tx: Tx, orderNo: string) {
  const code = orderPrefix(orderNo)!;
  const member = await tx.teamMember.findUnique({ where: { code } });
  ensure(member, `No team member has code ${code}. Add them under Team first.`);
  ensure(member.active, `Team member ${code} is disabled`);
  return member;
}

async function lockProducts(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort())
    await tx.$queryRaw`SELECT id FROM Product WHERE id = ${id} FOR UPDATE`;
}

/** Positive delta puts stock into the bucket, negative delta takes it out. */
async function adjustStock(
  tx: Tx,
  order: { id: string; orderNo: string; ownerId: string },
  productId: string,
  delta: Decimal,
  actor: Actor,
  bucket: "SELLABLE" | "DAMAGED" = "SELLABLE",
) {
  if (delta.isZero()) return;
  const damaged = bucket === "DAMAGED";
  const product = await tx.product.findUnique({ where: { id: productId } });
  ensure(product, "Product not found");
  if (delta.lt(0) && !damaged)
    ensure(product.active, `Product is archived: ${product.name}`);
  const need = delta.lt(0) ? delta.neg().toString() : null;
  if (order.ownerId === CENTRAL) {
    const field = damaged ? "damaged" : "stock";
    const changed = await tx.product.updateMany({
      where: { id: productId, ...(need ? { [field]: { gte: need } } : {}) },
      data: { [field]: { increment: delta.toString() } },
    });
    ensure(
      changed.count === 1,
      `Not enough ${damaged ? "damaged " : ""}stock: ${product.name}`,
    );
    await tx.stockMovement.create({
      data: {
        productId,
        type: "ORDER",
        bucket,
        quantity: delta.toString(),
        unitCost: product.averageCost,
        reference: order.id,
        reason: `Order ${order.orderNo} by ${actor.email || actor.id}`,
      },
    });
  } else {
    const field = damaged ? "damaged" : "quantity";
    const changed = await tx.locationBalance.updateMany({
      where: {
        ownerId: order.ownerId,
        productId,
        ...(need ? { [field]: { gte: need } } : {}),
      },
      data: { [field]: { increment: delta.toString() } },
    });
    ensure(
      changed.count === 1,
      `Not enough ${damaged ? "damaged " : ""}stock at this branch: ${product.name}`,
    );
  }
}

async function run<T>(fn: (tx: Tx) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 30000,
        maxWait: 10000,
      });
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

export async function findOrder(user: Actor, rawOrderNo: string) {
  canSell(user);
  const orderNo = orderNoSchema.parse(rawOrderNo);
  const order = await db.salesOrder.findUnique({
    where: { orderNo },
    include: orderInclude,
  });
  if (order) canAccess(user, order.ownerId);
  else await teamFor(db, orderNo);
  return order;
}

/** Adds the scanned product (one piece unless a quantity is given), creating the order if needed. */
export async function scanToOrder(raw: unknown, user: Actor) {
  canSell(user);
  const input = scanSchema.parse(raw);
  return run(async (tx) => {
    let order = await tx.salesOrder.findUnique({
      where: { orderNo: input.orderNo },
    });
    if (order) {
      canAccess(user, order.ownerId);
      await tx.$queryRaw`SELECT id FROM SalesOrder WHERE id = ${order.id} FOR UPDATE`;
      ensure(
        OPEN_STATUSES.includes(order.status),
        `Order ${order.orderNo} is ${STATUS_LABELS[order.status as keyof typeof STATUS_LABELS] ?? order.status}. Change its status back to Placed to add products.`,
      );
    }
    const matches = await tx.product.findMany({
      where: {
        OR: [
          { barcode: input.code },
          { sku: input.code },
          { name: input.code },
        ],
      },
      take: 3,
    });
    const product =
      matches.find((p) => p.barcode === input.code) ??
      matches.find((p) => p.sku === input.code) ??
      (matches.length === 1 ? matches[0] : undefined);
    ensure(product, `No product found for "${input.code}"`);
    if (!order) {
      const member = await teamFor(tx, input.orderNo);
      const ownerId = user.role === "ADMIN" ? input.ownerId : user.id;
      if (ownerId !== CENTRAL) {
        const owner = await tx.user.findUnique({ where: { id: ownerId } });
        ensure(
          owner?.active && owner.role === "BRANCH_MANAGER",
          "Choose central warehouse or an active branch",
        );
      }
      order = await tx.salesOrder.create({
        data: {
          orderNo: input.orderNo,
          teamMemberId: member.id,
          ownerId,
          createdById: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "ORDER_CREATE",
          reference: order.id,
          actorId: user.id,
          detail: JSON.stringify({ orderNo: order.orderNo, ownerId }),
        },
      });
    }
    await lockProducts(tx, [product.id]);
    await adjustStock(tx, order, product.id, D(input.quantity).neg(), user);
    await tx.salesOrderItem.upsert({
      where: { orderId_productId: { orderId: order.id, productId: product.id } },
      create: { orderId: order.id, productId: product.id, quantity: input.quantity },
      update: { quantity: { increment: input.quantity } },
    });
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { updatedAt: new Date() },
    });
    return {
      product: { id: product.id, name: product.name },
      order: await tx.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      }),
    };
  });
}

/** Sets the order to exactly these quantities (and order ID). Empty orders are deleted. */
export async function updateOrder(raw: unknown, user: Actor) {
  canSell(user);
  const input = updateSchema.parse(raw);
  ensure(
    new Set(input.items.map((i) => i.productId)).size === input.items.length,
    "Each product can appear only once",
  );
  return run(async (tx) => {
    await tx.$queryRaw`SELECT id FROM SalesOrder WHERE id = ${input.id} FOR UPDATE`;
    const order = await tx.salesOrder.findUnique({
      where: { id: input.id },
      include: { items: true },
    });
    ensure(order, "Order not found. Refresh and retry.");
    canAccess(user, order.ownerId);
    const wanted = new Map(
      input.items
        .filter((i) => i.quantity !== "0")
        .map((i) => [i.productId, D(i.quantity)]),
    );
    const current = new Map(order.items.map((i) => [i.productId, D(i.quantity)]));
    // Returned/cancelled orders already gave their stock back.
    const open = OPEN_STATUSES.includes(order.status);
    const changed = [...new Set([...wanted.keys(), ...current.keys()])].some(
      (id) => !(current.get(id) ?? D(0)).eq(wanted.get(id) ?? D(0)),
    );
    ensure(
      open || !changed || !wanted.size,
      `Order ${order.orderNo} is ${STATUS_LABELS[order.status as keyof typeof STATUS_LABELS] ?? order.status}. Change its status back to Placed to edit products.`,
    );
    // A damaged order is the record of why that damaged stock exists.
    ensure(
      order.status !== "DAMAGED" || wanted.size,
      `Order ${order.orderNo} is Damaged and its products are in damaged stock, so it cannot be deleted. Change its status first.`,
    );
    await lockProducts(tx, [...wanted.keys(), ...current.keys()]);
    for (const productId of new Set([...wanted.keys(), ...current.keys()])) {
      const before = current.get(productId) ?? D(0);
      const after = wanted.get(productId) ?? D(0);
      if (open) await adjustStock(tx, order, productId, before.minus(after), user);
      if (after.isZero())
        await tx.salesOrderItem.deleteMany({
          where: { orderId: order.id, productId },
        });
      else
        await tx.salesOrderItem.upsert({
          where: { orderId_productId: { orderId: order.id, productId } },
          create: { orderId: order.id, productId, quantity: after.toString() },
          update: { quantity: after.toString() },
        });
    }
    const detail = JSON.stringify({
      orderNo: input.orderNo,
      previousOrderNo: order.orderNo,
      items: [...wanted].map(([productId, q]) => ({ productId, quantity: q.toString() })),
    });
    if (!wanted.size) {
      await tx.salesOrder.delete({ where: { id: order.id } });
      await tx.auditLog.create({
        data: { action: "ORDER_DELETE", reference: order.id, actorId: user.id, detail },
      });
      return { order: null };
    }
    let teamMemberId = order.teamMemberId;
    if (input.orderNo !== order.orderNo) {
      teamMemberId = (await teamFor(tx, input.orderNo)).id;
      const clash = await tx.salesOrder.findUnique({
        where: { orderNo: input.orderNo },
      });
      ensure(!clash, `Order ID ${input.orderNo} is already used`);
    }
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { orderNo: input.orderNo, teamMemberId, updatedAt: new Date() },
    });
    await tx.auditLog.create({
      data: { action: "ORDER_EDIT", reference: order.id, actorId: user.id, detail },
    });
    return {
      order: await tx.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      }),
    };
  });
}

export async function deleteOrder(raw: unknown, user: Actor) {
  const { id } = deleteSchema.parse(raw);
  const order = await db.salesOrder.findUnique({ where: { id } });
  ensure(order, "Order not found. Refresh and retry.");
  return updateOrder({ id, orderNo: order.orderNo, items: [] }, user);
}

/** The sales team is one shared list; admins and branch managers both maintain it. */
const canManageTeam = (user: Actor) =>
  ["ADMIN", "BRANCH_MANAGER"].includes(user.role);

export async function saveTeamMember(raw: unknown, user: Actor) {
  ensure(canManageTeam(user), "Admin or branch access is required");
  const input = teamSchema.parse(raw);
  return run(async (tx) => {
    if (input.id) {
      const old = await tx.teamMember.findUnique({ where: { id: input.id } });
      ensure(old, "Team member not found");
      if (old.code !== input.code)
        ensure(
          (await tx.salesOrder.count({ where: { teamMemberId: old.id } })) === 0,
          "Code cannot change after orders exist for this member",
        );
    }
    const clash = await tx.teamMember.findUnique({ where: { code: input.code } });
    ensure(!clash || clash.id === input.id, `Code ${input.code} is already used`);
    const values = {
      name: input.name,
      code: input.code,
      phone: input.phone || null,
      active: input.active,
    };
    const member = input.id
      ? await tx.teamMember.update({ where: { id: input.id }, data: values })
      : await tx.teamMember.create({ data: values });
    await tx.auditLog.create({
      data: {
        action: input.id ? "TEAM_UPDATE" : "TEAM_CREATE",
        reference: member.id,
        actorId: user.id,
        detail: JSON.stringify(values),
      },
    });
    return { id: member.id };
  });
}

export const statusSchema = z.object({
  id: z.string().min(1).max(64),
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(2000).optional().default(""),
});

/** Changes order status. Moving to Returned/Cancelled puts stock back; reopening sells it again. */
export async function setOrderStatus(raw: unknown, user: Actor) {
  canSell(user);
  const input = statusSchema.parse(raw);
  return run(async (tx) => {
    await tx.$queryRaw`SELECT id FROM SalesOrder WHERE id = ${input.id} FOR UPDATE`;
    const order = await tx.salesOrder.findUnique({
      where: { id: input.id },
      include: { items: true },
    });
    ensure(order, "Order not found. Refresh and retry.");
    canAccess(user, order.ownerId);
    // Returned/Cancelled hold products as sellable stock, Damaged as damaged stock, open statuses nowhere.
    const from = statusBucket(order.status);
    const to = statusBucket(input.status);
    if (from !== to) {
      await lockProducts(tx, order.items.map((i) => i.productId));
      for (const item of order.items) {
        const q = D(item.quantity);
        if (from) await adjustStock(tx, order, item.productId, q.neg(), user, from);
        if (to) await adjustStock(tx, order, item.productId, q, user, to);
      }
    }
    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        status: input.status,
        statusNote: input.note || null,
        statusAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        action: "ORDER_STATUS",
        reference: order.id,
        actorId: user.id,
        detail: JSON.stringify({
          orderNo: order.orderNo,
          from: order.status,
          to: input.status,
          note: input.note,
        }),
      },
    });
    return {
      order: await tx.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      }),
    };
  });
}

export const searchSchema = z.object({
  q: z.string().max(64).optional().default(""),
  status: z.union([z.enum(ORDER_STATUSES), z.literal("")]).optional().default(""),
  member: z.string().max(64).optional().default(""),
});

/** Finds orders by (part of) the order ID, newest first. */
export async function searchOrders(raw: unknown, user: Actor) {
  canSell(user);
  const input = searchSchema.parse(raw);
  const q = normalizeOrderNo(input.q);
  return db.salesOrder.findMany({
    where: {
      ...(user.role === "ADMIN" ? {} : { ownerId: user.id }),
      ...(q ? { orderNo: { contains: q } } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.member ? { teamMemberId: input.member } : {}),
    },
    include: orderInclude,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}

export const ORDER_PAGE_SIZE = 50;
const day = z.union([z.string().date(), z.literal("")]).optional().default("");
export const listSchema = searchSchema.extend({
  owner: z.string().max(191).optional().default(""),
  from: day,
  to: day,
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

/** One page of orders for the Orders page, newest first, with a count per status. */
export async function listOrders(raw: unknown, user: Actor) {
  canSell(user);
  const input = listSchema.parse(raw);
  const q = normalizeOrderNo(input.q);
  // From/to are India calendar days; "to" includes the whole day.
  const from = input.from ? indiaDayStart(new Date(`${input.from}T12:00:00+05:30`)) : null;
  const to = input.to
    ? new Date(indiaDayStart(new Date(`${input.to}T12:00:00+05:30`)).getTime() + 86400000)
    : null;
  const base: Prisma.SalesOrderWhereInput = {
    ...(user.role === "ADMIN"
      ? input.owner
        ? { ownerId: input.owner }
        : {}
      : { ownerId: user.id }),
    ...(q ? { orderNo: { contains: q } } : {}),
    ...(input.member ? { teamMemberId: input.member } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
      : {}),
  };
  const where = { ...base, ...(input.status ? { status: input.status } : {}) };
  const [orders, total, counts] = await Promise.all([
    db.salesOrder.findMany({
      where,
      include: orderInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
    }),
    db.salesOrder.count({ where }),
    // Tab counts ignore the status filter so every tab shows its own total.
    db.salesOrder.groupBy({ by: ["status"], where: base, _count: true }),
  ]);
  return {
    orders,
    total,
    pageSize: ORDER_PAGE_SIZE,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  };
}

/** Deletes a team member who has no orders; members with orders must be disabled instead. */
export async function deleteTeamMember(raw: unknown, user: Actor) {
  ensure(canManageTeam(user), "Admin or branch access is required");
  const { id } = deleteSchema.parse(raw);
  return run(async (tx) => {
    const member = await tx.teamMember.findUnique({ where: { id } });
    ensure(member, "Team member not found. Refresh and retry.");
    const orders = await tx.salesOrder.count({ where: { teamMemberId: id } });
    ensure(
      orders === 0,
      `${member.name} (${member.code}) has ${orders} order(s), so they cannot be deleted. Edit and untick "Active" to disable them instead.`,
    );
    await tx.teamMember.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        action: "TEAM_DELETE",
        reference: id,
        actorId: user.id,
        detail: JSON.stringify({ name: member.name, code: member.code }),
      },
    });
    return { id };
  });
}

/** Midnight India time today, as a UTC Date. */
export function indiaDayStart(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60000);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60000,
  );
}

/** Recent orders, per-member totals and dashboard figures for the user's scope. */
export async function salesWorkspace(tx: Tx, user: Actor) {
  const empty = {
    team: [],
    orders: [],
    teamSummary: [],
    salesStats: {
      todayOrders: 0,
      todayPieces: "0",
      today: [] as { teamMemberId: string; orders: number; pieces: string }[],
      statuses: {} as Record<string, number>,
      week: [] as { day: string; orders: number; pieces: string }[],
    },
  };
  if (!["ADMIN", "BRANCH_MANAGER"].includes(user.role)) return empty;
  const admin = user.role === "ADMIN";
  const scope = admin ? {} : { ownerId: user.id };
  const owner = admin ? Prisma.empty : Prisma.sql`AND o.ownerId = ${user.id}`;
  const open = Prisma.sql`o.status IN (${Prisma.join([...OPEN_STATUSES])})`;
  const today = indiaDayStart();
  const weekStart = new Date(today.getTime() - 6 * 86400000);
  type Row = { teamMemberId: string; orders: bigint; pieces: unknown; returned?: bigint };
  const [team, orders, summary, todayRows, statuses, week] = await Promise.all([
    tx.teamMember.findMany({
      select: { id: true, name: true, code: true, phone: true, active: true },
      orderBy: { code: "asc" },
    }),
    tx.salesOrder.findMany({
      where: scope,
      include: orderInclude,
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    tx.$queryRaw<Row[]>`
      SELECT o.teamMemberId AS teamMemberId,
             COUNT(DISTINCT CASE WHEN ${open} THEN o.id END) AS orders,
             COALESCE(SUM(CASE WHEN ${open} THEN i.quantity END), 0) AS pieces,
             COUNT(DISTINCT CASE WHEN o.status = 'RETURNED' THEN o.id END) AS returned
      FROM SalesOrder o LEFT JOIN SalesOrderItem i ON i.orderId = o.id
      WHERE 1 = 1 ${owner}
      GROUP BY o.teamMemberId`,
    tx.$queryRaw<Row[]>`
      SELECT o.teamMemberId AS teamMemberId,
             COUNT(DISTINCT o.id) AS orders,
             COALESCE(SUM(i.quantity), 0) AS pieces
      FROM SalesOrder o LEFT JOIN SalesOrderItem i ON i.orderId = o.id
      WHERE ${open} AND o.createdAt >= ${today} ${owner}
      GROUP BY o.teamMemberId`,
    tx.salesOrder.groupBy({ by: ["status"], where: scope, _count: true }),
    tx.$queryRaw<{ day: string; orders: bigint; pieces: unknown }[]>`
      SELECT DATE_FORMAT(CONVERT_TZ(o.createdAt, '+00:00', '+05:30'), '%Y-%m-%d') AS day,
             COUNT(DISTINCT o.id) AS orders,
             COALESCE(SUM(i.quantity), 0) AS pieces
      FROM SalesOrder o LEFT JOIN SalesOrderItem i ON i.orderId = o.id
      WHERE ${open} AND o.createdAt >= ${weekStart} ${owner}
      GROUP BY day ORDER BY day`,
  ]);
  const todayList = todayRows.map((r) => ({
    teamMemberId: r.teamMemberId,
    orders: Number(r.orders),
    pieces: String(r.pieces),
  }));
  return {
    team,
    orders,
    teamSummary: summary.map((s) => ({
      teamMemberId: s.teamMemberId,
      orders: Number(s.orders),
      pieces: String(s.pieces),
      returned: Number(s.returned ?? 0),
    })),
    salesStats: {
      todayOrders: todayList.reduce((n, r) => n + r.orders, 0),
      todayPieces: String(todayList.reduce((n, r) => n + Number(r.pieces), 0)),
      today: todayList,
      statuses: Object.fromEntries(statuses.map((s) => [s.status, s._count])),
      week: week.map((w) => ({
        day: String(w.day),
        orders: Number(w.orders),
        pieces: String(w.pieces),
      })),
    },
  };
}
