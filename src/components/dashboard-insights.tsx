"use client";
import { dashboardSummary } from "@/lib/dashboard";

type SummaryArgs = Parameters<typeof dashboardSummary>;
export default function DashboardInsights({
  data,
}: {
  data: {
    products: SummaryArgs[0];
    events: SummaryArgs[1];
    legacySales: SummaryArgs[2];
    settings: { minStock: string };
    user: { role: string };
  };
}) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const s = dashboardSummary(
    data.products,
    data.events,
    data.legacySales,
    data.settings.minStock,
    today,
  );
  const fmt = (value: string) =>
    Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return (
    <>
      <div className="quantity-cards">
        {[
          ["Expiring within 1 year", s.expiring.length],
          ["Already expired", s.expired.length],
          ["Low stock", s.low.length],
          ["Out of stock", s.out.length],
        ].map(([title, value]) => (
          <section className="panel" key={title}>
            <p className="muted small">{title}</p>
            <strong className="quantity-number">{value}</strong>
            <p className="small muted">products</p>
          </section>
        ))}
      </div>
      <section className="panel">
        <h2>Medicines expiring within 1 year</h2>
        <p className="small muted">
          {today} through {s.until}, inclusive. Based on product expiry dates
          and{" "}
          {data.user.role === "ADMIN" ? "central warehouse" : "your location’s"}{" "}
          stock. Expiry remains valid through the printed date.
        </p>
        {s.expiring.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Expiry date</th>
                  <th>Available quantity</th>
                </tr>
              </thead>
              <tbody>
                {s.expiring.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.expiryDate?.slice(0, 10)}</td>
                    <td>{fmt(p.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No stocked medicines expire in the next year.</p>
        )}
      </section>
      <section className="panel">
        <h2>Top selling products</h2>
        <p className="small muted">
          All time · net units sold after returns ·{" "}
          {data.user.role === "ADMIN"
            ? "all locations, including earlier sales"
            : "your location"}
          . Cancelled sales are excluded.
        </p>
        {s.top.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Product</th>
                  <th>Net units sold</th>
                </tr>
              </thead>
              <tbody>
                {s.top.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>{p.name}</td>
                    <td>{fmt(p.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No sales to rank yet.</p>
        )}
      </section>
      <section className="panel">
        <h2>Stock needing attention</h2>
        {!s.expired.length && !s.low.length && !s.out.length ? (
          <p>No expiry or stock alerts.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Alert</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...s.expired.map((p) => ({
                    p,
                    alert: `Expired ${p.expiryDate?.slice(0, 10)}`,
                  })),
                  ...s.low.map((p) => ({ p, alert: "Low stock" })),
                  ...s.out.map((p) => ({ p, alert: "Out of stock" })),
                ].map(({ p, alert }) => (
                  <tr key={`${p.id}-${alert}`}>
                    <td>{p.name}</td>
                    <td>{alert}</td>
                    <td>{fmt(p.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
