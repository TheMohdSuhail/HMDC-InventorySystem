import Decimal from "decimal.js";
import { InventoryError } from "./errors";
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const D = (value: Decimal.Value | { toString(): string }) =>
  new Decimal(value.toString());
export function weightedCost(
  stock: Decimal.Value,
  cost: Decimal.Value,
  received: Decimal.Value,
  incoming: Decimal.Value,
) {
  const quantity = D(stock).plus(received);
  return quantity.isZero()
    ? D(0)
    : D(stock)
        .mul(cost)
        .plus(D(received).mul(incoming))
        .div(quantity)
        .toDecimalPlaces(6);
}
export function saleLine(
  quantity: Decimal.Value,
  price: Decimal.Value,
  discount: Decimal.Value,
  cost: Decimal.Value,
) {
  const gross = D(quantity).mul(price).toDecimalPlaces(4);
  if (D(discount).gt(gross))
    throw new InventoryError("Discount exceeds line value");
  return {
    gross,
    total: gross.minus(discount),
    cogs: D(quantity).mul(cost).toDecimalPlaces(4),
  };
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "\uFEFFNo records\r\n";
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (value: unknown) => {
    let s =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(s) && !/^-?\d+(?:\.\d+)?$/.test(s))
      s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      keys.map(cell).join(","),
      ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
    ].join("\r\n")
  );
}
