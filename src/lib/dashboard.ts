import { D } from "./math";

type Product = {
  id: string;
  name: string;
  active: boolean;
  stock: string;
  expiryDate: string | null;
  minStock?: string | null;
};
type Line = { productId: string; quantity: string; processed: string };
export function dashboardSummary(
  products: Product[],
  events: { type: string; items: Line[] }[],
  legacySales: {
    status: string;
    items: { productId: string; quantity: string; returned: string }[];
  }[],
  minimum: string,
  today: string,
) {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const until = end.toISOString().slice(0, 10);
  const stocked = products.filter((p) => D(p.stock).gt(0));
  const expiry = (p: Product) => p.expiryDate?.slice(0, 10) ?? "";
  const expiring = stocked
    .filter((p) => expiry(p) >= today && expiry(p) <= until)
    .sort(
      (a, b) =>
        expiry(a).localeCompare(expiry(b)) || a.name.localeCompare(b.name),
    );
  const expired = stocked.filter((p) => expiry(p) && expiry(p) < today);
  const active = products.filter((p) => p.active);
  const low = active.filter(
    (p) => D(p.stock).gt(0) && D(p.stock).lte(p.minStock ?? minimum),
  );
  const out = active.filter((p) => D(p.stock).isZero());
  const totals = new Map<string, ReturnType<typeof D>>();
  const add = (id: string, quantity: string, returned: string) =>
    totals.set(id, (totals.get(id) ?? D(0)).plus(D(quantity).minus(returned)));
  for (const event of events)
    if (event.type === "SALE")
      for (const line of event.items)
        add(line.productId, line.quantity, line.processed);
  for (const sale of legacySales)
    if (sale.status === "COMPLETED")
      for (const line of sale.items)
        add(line.productId, line.quantity, line.returned);
  const top = [...totals]
    .filter(([, n]) => n.gt(0))
    .sort(([a, x], [b, y]) => y.comparedTo(x) || a.localeCompare(b))
    .slice(0, 5)
    .map(([id, n]) => ({
      id,
      name: products.find((p) => p.id === id)?.name ?? "Archived product",
      quantity: n.toString(),
    }));
  return { expiring, expired, low, out, top, until };
}
