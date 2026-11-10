import { db } from "./db";
import { D } from "./math";
export const day = (d: Date) =>
  new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
export function range(params: URLSearchParams) {
  const today = day(new Date());
  const start = params.get("from") || today;
  const end = params.get("to") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end))
    throw new Error("Invalid date range");
  const from = new Date(start + "T00:00:00+05:30");
  const to = new Date(new Date(end + "T00:00:00+05:30").getTime() + 86400000);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to)
    throw new Error("Invalid date range");
  return { from, to, where: { gte: from, lt: to } };
}
export async function reports(params: URLSearchParams) {
  const r = range(params);
  return db.$transaction(
    async (tx) => {
      const [
        products,
        sales,
        cancellations,
        returns,
        movements,
        orders,
        receipts,
        allMovements,
      ] = await Promise.all([
        tx.product.findMany({ orderBy: { name: "asc" } }),
        tx.sale.findMany({
          where: { createdAt: r.where },
          include: { items: { include: { product: true } } },
        }),
        tx.sale.findMany({
          where: { cancelledAt: r.where },
          include: { items: { include: { product: true } } },
        }),
        tx.salesReturn.findMany({
          where: { createdAt: r.where },
          include: { items: { include: { product: true } } },
        }),
        tx.stockMovement.findMany({
          where: { createdAt: r.where },
          include: { product: true },
          orderBy: { createdAt: "asc" },
        }),
        tx.purchaseOrder.findMany({
          where: { createdAt: r.where },
          include: { supplier: true, items: { include: { product: true } } },
        }),
        tx.purchaseReceipt.findMany({
          where: { createdAt: r.where },
          include: { items: true },
        }),
        tx.stockMovement.findMany({
          where: { createdAt: { lt: r.to } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ]);
      const buckets = new Map<
        string,
        {
          date: string;
          orders: number;
          sold: ReturnType<typeof D>;
          gross: ReturnType<typeof D>;
          discount: ReturnType<typeof D>;
          refund: ReturnType<typeof D>;
          cogs: ReturnType<typeof D>;
        }
      >();
      const bucket = (date: Date) => {
        const key = day(date);
        if (!buckets.has(key))
          buckets.set(key, {
            date: key,
            orders: 0,
            sold: D(0),
            gross: D(0),
            discount: D(0),
            refund: D(0),
            cogs: D(0),
          });
        return buckets.get(key)!;
      };
      const byProduct = new Map(
        products.map((p) => [
          p.id,
          {
            product: p.name,
            sold: D(0),
            returned: D(0),
            netSales: D(0),
            cogs: D(0),
          },
        ]),
      );
      for (const s of sales) {
        const b = bucket(s.createdAt);
        b.orders++;
        b.gross = b.gross.plus(s.gross.toString());
        b.discount = b.discount.plus(s.discount.toString());
        b.cogs = b.cogs.plus(s.cogs.toString());
        for (const x of s.items) {
          b.sold = b.sold.plus(x.quantity.toString());
          const p = byProduct.get(x.productId)!;
          p.sold = p.sold.plus(x.quantity.toString());
          p.netSales = p.netSales.plus(x.total.toString());
          p.cogs = p.cogs.plus(D(x.quantity).mul(x.unitCost.toString()));
        }
      }
      for (const s of cancellations) {
        const b = bucket(s.cancelledAt!);
        b.orders--;
        b.gross = b.gross.minus(s.gross.toString());
        b.discount = b.discount.minus(s.discount.toString());
        b.cogs = b.cogs.minus(s.cogs.toString());
        for (const x of s.items) {
          b.sold = b.sold.minus(x.quantity.toString());
          const p = byProduct.get(x.productId)!;
          p.sold = p.sold.minus(x.quantity.toString());
          p.netSales = p.netSales.minus(x.total.toString());
          p.cogs = p.cogs.minus(D(x.quantity).mul(x.unitCost.toString()));
        }
      }
      for (const ret of returns) {
        const b = bucket(ret.createdAt);
        b.refund = b.refund.plus(ret.refund.toString());
        for (const x of ret.items) {
          const p = byProduct.get(x.productId)!;
          p.returned = p.returned.plus(x.quantity.toString());
          p.netSales = p.netSales.minus(x.refund.toString());
          if (x.saleItemId) {
            const cost = D(x.quantity).mul(x.unitCost.toString());
            p.cogs = p.cogs.minus(cost);
            b.cogs = b.cogs.minus(cost);
          }
        }
      }
      const daily = [...buckets.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((b) => ({
          date: b.date,
          orders: b.orders,
          sold: b.sold.toString(),
          gross: b.gross.toFixed(2),
          discounts: b.discount.toFixed(2),
          refunds: b.refund.toFixed(2),
          netSales: b.gross.minus(b.discount).minus(b.refund).toFixed(2),
          cogs: b.cogs.toFixed(2),
          grossProfit: b.gross
            .minus(b.discount)
            .minus(b.refund)
            .minus(b.cogs)
            .toFixed(2),
        }));
      const productSales = [...byProduct.values()].map((p) => ({
        product: p.product,
        sold: p.sold.toString(),
        returned: p.returned.toString(),
        netQuantity: p.sold.minus(p.returned).toString(),
        netSales: p.netSales.toFixed(2),
        grossProfit: p.netSales.minus(p.cogs).toFixed(2),
      }));
      const lossTypes = [
        "DAMAGED",
        "EXPIRED",
        "MISSING",
        "THEFT",
        "WRITE_OFF",
        "CORRECTION_OUT",
      ];
      const losses = movements
        .filter(
          (m) =>
            (m.bucket === "SELLABLE" &&
              D(m.quantity).lt(0) &&
              lossTypes.includes(m.type)) ||
            (m.type === "CUSTOMER_RETURN" && m.bucket !== "SELLABLE") ||
            m.type === "BUCKET_RELEASE",
        )
        .map((m) => ({
          date: day(m.createdAt),
          product: m.product.name,
          reason: m.type === "CUSTOMER_RETURN" ? `${m.bucket} RETURN` : m.type,
          quantity: (m.type === "BUCKET_RELEASE"
            ? D(m.quantity)
            : D(m.quantity).abs()
          ).toString(),
          loss: (m.type === "BUCKET_RELEASE"
            ? D(m.quantity)
            : D(m.quantity).abs()
          )
            .mul(m.unitCost.toString())
            .toFixed(2),
          notes: m.reason,
        }));
      const stock = products.map((p) => {
        const all = allMovements.filter(
          (m) => m.productId === p.id && m.bucket === "SELLABLE",
        );
        const before = all
          .filter((m) => m.createdAt < r.from)
          .reduce((s, m) => s.plus(m.quantity.toString()), D(0));
        const within = all.filter((m) => m.createdAt >= r.from);
        const sum = (types: string[]) =>
          within
            .filter((m) => types.includes(m.type))
            .reduce((s, m) => s.plus(m.quantity.toString()), D(0))
            .toString();
        return {
          product: p.name,
          opening: before.toString(),
          purchasesReceived: sum(["PURCHASE_RECEIPT"]),
          sales: sum(["SALE"]),
          sellableReturns: sum(["CUSTOMER_RETURN"]),
          saleReversals: sum(["SALE_REVERSAL"]),
          writeOffs: sum(lossTypes),
          otherAdjustments: sum(["OPENING", "RECOVERY", "CORRECTION_IN", "ADJUSTMENT"]),
          closing: all
            .reduce((s, m) => s.plus(m.quantity.toString()), D(0))
            .toString(),
          damagedReturns: movements
            .filter(
              (m) =>
                m.productId === p.id &&
                m.type === "CUSTOMER_RETURN" &&
                m.bucket === "DAMAGED",
            )
            .reduce((s, m) => s.plus(m.quantity.toString()), D(0))
            .toString(),
        };
      });
      const valuation = products.map((p) => {
        let qty = D(0),
          value = D(0);
        for (const m of allMovements.filter(
          (m) => m.productId === p.id && m.bucket === "SELLABLE",
        )) {
          qty = qty.plus(m.quantity.toString());
          value = value.plus(D(m.quantity).mul(m.unitCost.toString()));
        }
        // Movement costs retain historical receipt and sale costs. Zero quantity has no residual valuation.
        if (qty.isZero()) value = D(0);
        return {
          product: p.name,
          quantity: qty.toString(),
          cost: qty.isZero() ? "0" : value.div(qty).toFixed(6),
          value: value.toFixed(2),
        };
      });
      const purchase = orders.flatMap((o) =>
        o.items.map((x) => ({
          date: day(o.createdAt),
          order: o.number,
          supplier: o.supplier.name,
          product: x.product.name,
          ordered: x.quantity.toString(),
          received: x.received.toString(),
          pending:
            o.status === "CANCELLED"
              ? "0"
              : D(x.quantity).minus(x.received.toString()).toString(),
          purchaseValue: D(x.quantity).mul(x.unitCost.toString()).toFixed(2),
          orderTotal: o.total.toString(),
          orderPaid: o.paid.toString(),
          paymentStatus: o.paid.eq(o.total)
            ? "PAID"
            : o.paid.gt(0)
              ? "PARTIAL"
              : "UNPAID",
          status: o.status,
        })),
      );
      const total = (field: keyof (typeof daily)[number]) =>
        daily.reduce((s, x) => s.plus(String(x[field])), D(0)).toFixed(2);
      const summary = {
        gross: total("gross"),
        discounts: total("discounts"),
        refunds: total("refunds"),
        netSales: total("netSales"),
        cogs: total("cogs"),
        grossProfit: total("grossProfit"),
        sold: total("sold"),
        orders: daily.reduce((s, x) => s + x.orders, 0),
        loss: losses.reduce((s, x) => s.plus(x.loss), D(0)).toFixed(2),
        purchasesReceived: receipts
          .reduce(
            (s, x) =>
              x.items.reduce(
                (v, y) => v.plus(D(y.quantity).mul(y.unitCost.toString())),
                s,
              ),
            D(0),
          )
          .toFixed(2),
      };
      return {
        daily,
        productSales,
        stock,
        purchase,
        valuation,
        losses,
        summary,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
