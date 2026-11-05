import { Prisma } from "@prisma/client";
import { db } from "./db";
import { D, weightedCost, saleLine } from "./math";
import type { OperationInput } from "./validation";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { authorizeOperation } from "./permissions";
import { InventoryError } from "./errors";
type Tx = Prisma.TransactionClient;
const number = (prefix: string) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new InventoryError(message);
}
async function product(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM Product WHERE id = ${id} FOR UPDATE`;
  const p = await tx.product.findUnique({ where: { id } });
  assert(p, "Product not found");
  return p;
}
async function lockProducts(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await product(tx, id);
}
async function movement(
  tx: Tx,
  productId: string,
  type: string,
  quantity: Prisma.Decimal | string,
  bucket: string,
  unitCost: Prisma.Decimal | string,
  reference: string,
  reason?: string,
) {
  await tx.stockMovement.create({
    data: { productId, type, quantity, bucket, unitCost, reference, reason },
  });
}
async function receive(
  tx: Tx,
  id: string,
  quantity: string,
  cost: string,
  type: string,
  reference: string,
  reason?: string,
) {
  const p = await product(tx, id);
  const averageCost = weightedCost(
    p.stock.toString(),
    p.averageCost.toString(),
    quantity,
    cost,
  ).toFixed(6);
  await tx.product.update({
    where: { id },
    data: { stock: { increment: quantity }, averageCost },
  });
  await movement(tx, id, type, quantity, "SELLABLE", cost, reference, reason);
}
async function deduct(
  tx: Tx,
  id: string,
  quantity: string,
  type: string,
  reference: string,
  reason?: string,
) {
  const p = await product(tx, id);
  const result = await tx.product.updateMany({
    where: { id, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });
  assert(result.count === 1, `Insufficient sellable stock for ${p.name}`);
  await movement(
    tx,
    id,
    type,
    D(quantity).neg().toString(),
    "SELLABLE",
    p.averageCost,
    reference,
    reason,
  );
  return p;
}
async function order(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM PurchaseOrder WHERE id = ${id} FOR UPDATE`;
  const po = await tx.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  assert(po, "Purchase order not found");
  return po;
}
async function sale(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM Sale WHERE id = ${id} FOR UPDATE`;
  const s = await tx.sale.findUnique({
    where: { id },
    include: { items: true },
  });
  assert(s, "Sale not found");
  return s;
}
function unique(ids: string[]) {
  assert(
    new Set(ids).size === ids.length,
    "Combine duplicate lines before submitting",
  );
}
export async function execute(
  input: OperationInput,
  actorId = "system",
  role = "ADMIN",
) {
  authorizeOperation(role, input);
  const cached = await db.operation.findUnique({
    where: { key: input.requestKey },
  });
  if (cached) {
    assert(cached.action === input.action, "Request key already used");
    return JSON.parse(cached.result);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.operation.create({
            data: {
              key: input.requestKey,
              action: input.action,
              result: "null",
            },
          });
          const result = await perform(tx, input, role);
          await tx.operation.update({
            where: { key: input.requestKey },
            data: { result: JSON.stringify(result) },
          });
          await tx.auditLog.create({
            data: {
              action: input.action,
              reference: input.requestKey,
              actorId,
              detail: JSON.stringify(input),
            },
          });
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 20000,
        },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === "P2002") {
          const prior = await db.operation.findUnique({
            where: { key: input.requestKey },
          });
          if (prior) {
            assert(prior.action === input.action, "Request key already used");
            return JSON.parse(prior.result);
          }
        }
        if (e.code === "P2034" && attempt < 2) continue;
      }
      throw e;
    }
  }
  throw new InventoryError("Concurrent change; please retry");
}
async function perform(
  tx: Tx,
  i: OperationInput,
  role: string,
): Promise<{ id: string; number?: string }> {
  if (i.action === "sale") {
    unique(i.items.map((x) => x.productId));
    await lockProducts(
      tx,
      i.items.map((x) => x.productId),
    );
    const rows = [];
    for (const item of i.items) {
      const p = await product(tx, item.productId);
      assert(p.active, `${p.name} is archived`);
      assert(
        !item.overridePrice || item.overrideReason,
        "Price overrides require a reason",
      );
      const price = item.overridePrice ?? p.sellingPrice.toString();
      const values = saleLine(
        item.quantity,
        price,
        item.discount,
        p.averageCost.toString(),
      );
      assert(
        p.stock.gte(item.quantity),
        `Insufficient sellable stock for ${p.name}`,
      );
      rows.push({
        productId: p.id,
        quantity: item.quantity,
        unitPrice: price,
        unitCost: p.averageCost,
        discount: item.discount,
        total: values.total.toFixed(4),
        overrideReason: item.overrideReason,
        gross: values.gross,
        cogs: values.cogs,
      });
    }
    const s = await tx.sale.create({
      data: {
        number: number("S"),
        requestKey: i.requestKey,
        customer: i.customer,
        notes: i.notes,
        total: rows.reduce((v, r) => v.plus(r.total), D(0)).toFixed(4),
        gross: rows.reduce((v, r) => v.plus(r.gross), D(0)).toFixed(4),
        discount: rows.reduce((v, r) => v.plus(r.discount), D(0)).toFixed(4),
        cogs: rows.reduce((v, r) => v.plus(r.cogs), D(0)).toFixed(4),
        items: {
          create: rows.map(({ gross, cogs, ...r }) => {
            void gross;
            void cogs;
            return r;
          }),
        },
      },
    });
    for (const r of rows)
      await deduct(tx, r.productId, r.quantity, "SALE", s.id);
    return { id: s.id, number: s.number };
  }
  if (i.action === "purchase") {
    unique(i.items.map((x) => x.productId));
    const supplier = await tx.supplier.findUnique({
      where: { id: i.supplierId },
    });
    assert(supplier?.active, "Select an active supplier");
    await lockProducts(
      tx,
      i.items.map((x) => x.productId),
    );
    for (const row of i.items)
      assert(
        (await product(tx, row.productId)).active,
        "Cannot order archived products",
      );
    const p = await tx.purchaseOrder.create({
      data: {
        number: number("PO"),
        requestKey: i.requestKey,
        supplierId: i.supplierId,
        status: i.status,
        notes: i.notes,
        expectedAt: i.expectedAt ? new Date(i.expectedAt + "T00:00:00Z") : null,
        total: i.items
          .reduce((sum, r) => sum.plus(D(r.quantity).mul(r.unitCost)), D(0))
          .toFixed(4),
        items: { create: i.items },
      },
    });
    return { id: p.id, number: p.number };
  }
  if (i.action === "receipt") {
    unique(i.items.map((x) => x.orderItemId));
    const po = await order(tx, i.orderId);
    assert(
      ["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status),
      "Order is not open for receiving",
    );
    await lockProducts(
      tx,
      po.items.map((x) => x.productId),
    );
    const receipt = await tx.purchaseReceipt.create({
      data: { orderId: po.id, requestKey: i.requestKey },
    });
    for (const r of i.items) {
      const row = po.items.find((x) => x.id === r.orderItemId);
      assert(row, "Item is not part of this order");
      assert(
        D(row.quantity).minus(row.received.toString()).gte(r.quantity),
        "Receipt exceeds pending quantity",
      );
      if (role !== "ADMIN")
        assert(
          !r.unitCost || D(r.unitCost).eq(row.unitCost),
          "Only an admin may change receipt costs",
        );
      const cost = r.unitCost ?? row.unitCost.toString();
      // Agreed order cost remains fixed; actual receipt cost is preserved for valuation.
      await tx.purchaseReceiptItem.create({
        data: {
          receiptId: receipt.id,
          orderItemId: row.id,
          quantity: r.quantity,
          unitCost: cost,
        },
      });
      await tx.purchaseOrderItem.update({
        where: { id: row.id },
        data: { received: { increment: r.quantity } },
      });
      await receive(
        tx,
        row.productId,
        r.quantity,
        cost,
        "PURCHASE_RECEIPT",
        receipt.id,
      );
    }
    const updated = await tx.purchaseOrderItem.findMany({
      where: { orderId: po.id },
    });
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: updated.every((x) => x.received.eq(x.quantity))
          ? "RECEIVED"
          : "PARTIALLY_RECEIVED",
      },
    });
    return { id: receipt.id };
  }
  if (i.action === "return") {
    unique(i.items.map((x) => x.saleItemId ?? x.productId));
    const linked = await tx.saleItem.findMany({
      where: {
        id: {
          in: i.items.flatMap((x) => (x.saleItemId ? [x.saleItemId] : [])),
        },
      },
    });
    for (const id of [...new Set(linked.map((x) => x.saleId))].sort()) {
      const s = await sale(tx, id);
      assert(s.status === "COMPLETED", "Cannot return a cancelled sale");
    }
    await lockProducts(
      tx,
      i.items.map((x) => x.productId),
    );
    const ret = await tx.salesReturn.create({
      data: {
        number: number("R"),
        requestKey: i.requestKey,
        reason: i.reason,
        notes: i.notes,
        manual: i.items.some((x) => !x.saleItemId),
        refund: "0",
      },
    });
    let refunds = D(0);
    for (const r of i.items) {
      const p = await product(tx, r.productId);
      let cost = p.averageCost.toString();
      let refund = D(r.refund ?? "0");
      if (r.saleItemId) {
        const row = await tx.saleItem.findUnique({
          where: { id: r.saleItemId },
        });
        assert(
          row && row.productId === r.productId,
          "Invalid original sale item",
        );
        const remaining = D(row.quantity).minus(row.returned.toString());
        assert(
          remaining.gte(r.quantity),
          "Return exceeds remaining returnable quantity",
        );
        const prior = await tx.returnItem.aggregate({
          where: { saleItemId: row.id },
          _sum: { refund: true },
        });
        const refundable = D(row.total).minus(
          prior._sum.refund?.toString() ?? "0",
        );
        const allocated = D(row.total)
          .div(row.quantity.toString())
          .mul(r.quantity)
          .toDecimalPlaces(4);
        refund = r.refund ? D(r.refund) : Decimal.min(allocated, refundable);
        assert(
          refund.lte(Decimal.min(allocated, refundable)),
          "Refund exceeds original net selling value",
        );
        cost = row.unitCost.toString();
        await tx.saleItem.update({
          where: { id: row.id },
          data: { returned: { increment: r.quantity } },
        });
      }
      await tx.returnItem.create({
        data: {
          returnId: ret.id,
          saleItemId: r.saleItemId,
          productId: p.id,
          quantity: r.quantity,
          condition: r.condition,
          refund: refund.toFixed(4),
          unitCost: cost,
        },
      });
      if (r.condition === "SELLABLE")
        await receive(
          tx,
          p.id,
          r.quantity,
          cost,
          "CUSTOMER_RETURN",
          ret.id,
          i.reason,
        );
      else {
        const field =
          r.condition === "DAMAGED"
            ? "damaged"
            : r.condition === "EXPIRED"
              ? "expired"
              : "quarantined";
        await tx.product.update({
          where: { id: p.id },
          data: { [field]: { increment: r.quantity } },
        });
        await movement(
          tx,
          p.id,
          "CUSTOMER_RETURN",
          r.quantity,
          r.condition,
          cost,
          ret.id,
          i.reason,
        );
      }
      refunds = refunds.plus(refund);
    }
    await tx.salesReturn.update({
      where: { id: ret.id },
      data: { refund: refunds.toFixed(4) },
    });
    return { id: ret.id, number: ret.number };
  }
  if (i.action === "adjustment") {
    const p = await product(tx, i.productId);
    if (i.type === "OPENING")
      assert(
        (await tx.stockMovement.count({ where: { productId: p.id } })) === 0,
        "Opening stock is allowed only before the first stock movement",
      );
    const incoming = ["OPENING", "RECOVERY", "CORRECTION_IN"].includes(i.type);
    if (incoming)
      await receive(
        tx,
        p.id,
        i.quantity,
        i.unitCost ?? p.purchasePrice.toString(),
        i.type,
        i.requestKey,
        i.reason,
      );
    else {
      await deduct(tx, p.id, i.quantity, i.type, i.requestKey, i.reason);
      if (["DAMAGED", "EXPIRED"].includes(i.type)) {
        await tx.product.update({
          where: { id: p.id },
          data: {
            [i.type === "DAMAGED" ? "damaged" : "expired"]: {
              increment: i.quantity,
            },
          },
        });
        await movement(
          tx,
          p.id,
          i.type,
          i.quantity,
          i.type,
          p.averageCost,
          i.requestKey,
          i.reason,
        );
      }
    }
    return { id: i.requestKey };
  }
  if (i.action === "cancelSale") {
    const s = await sale(tx, i.saleId);
    assert(s.status === "COMPLETED", "Sale already cancelled");
    assert(
      s.items.every((x) => x.returned.isZero()),
      "Sales with returns cannot be cancelled; preserve the return history",
    );
    await lockProducts(
      tx,
      s.items.map((x) => x.productId),
    );
    for (const r of s.items)
      await receive(
        tx,
        r.productId,
        r.quantity.toString(),
        r.unitCost.toString(),
        "SALE_REVERSAL",
        s.id,
        i.reason,
      );
    await tx.sale.update({
      where: { id: s.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: i.reason,
      },
    });
    return { id: s.id };
  }
  if (i.action === "bucketAdjustment") {
    const p = await product(tx, i.productId);
    const field =
      i.bucket === "DAMAGED"
        ? "damaged"
        : i.bucket === "EXPIRED"
          ? "expired"
          : "quarantined";
    assert(
      p[field].gte(i.quantity),
      "Quantity exceeds the stock in this bucket",
    );
    assert(
      i.type !== "RELEASE" || i.bucket === "QUARANTINED",
      "Only inspected quarantined stock can be released as sellable",
    );
    const history = await tx.stockMovement.findMany({
      where: { productId: p.id, bucket: i.bucket },
    });
    const value = history.reduce(
      (v, m) => v.plus(D(m.quantity).mul(m.unitCost.toString())),
      D(0),
    );
    const cost = value.div(p[field].toString()).toDecimalPlaces(6).toString();
    await tx.product.update({
      where: { id: p.id },
      data: { [field]: { decrement: i.quantity } },
    });
    await movement(
      tx,
      p.id,
      i.type === "RELEASE" ? "BUCKET_RELEASE" : "BUCKET_DISPOSAL",
      D(i.quantity).neg().toString(),
      i.bucket,
      cost,
      i.requestKey,
      i.reason,
    );
    if (i.type === "RELEASE")
      await receive(
        tx,
        p.id,
        i.quantity,
        cost,
        "RECOVERY",
        i.requestKey,
        i.reason,
      );
    return { id: i.requestKey };
  }
  if (i.action === "orderStatus") {
    const po = await order(tx, i.orderId);
    if (i.status === "CANCELLED")
      assert(
        ["DRAFT", "ORDERED"].includes(po.status) &&
          po.items.every((x) => x.received.isZero()) &&
          po.paid.isZero(),
        "Only unreceived, unpaid orders can be cancelled",
      );
    else assert(po.status === "DRAFT", "Only a draft can be placed");
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: i.status },
    });
    return { id: po.id };
  }
  const po = await order(tx, i.orderId);
  assert(!["DRAFT", "CANCELLED"].includes(po.status), "Cannot pay this order");
  assert(
    D(po.total).minus(po.paid.toString()).gte(i.amount),
    "Payment exceeds outstanding balance",
  );
  const payment = await tx.supplierPayment.create({
    data: {
      orderId: po.id,
      requestKey: i.requestKey,
      amount: i.amount,
      method: i.method,
      reference: i.reference,
    },
  });
  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: { paid: { increment: i.amount } },
  });
  return { id: payment.id };
}
