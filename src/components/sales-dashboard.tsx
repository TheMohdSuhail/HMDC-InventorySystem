"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import type { Prisma } from "@prisma/client";
import type { Workspace } from "@/lib/workspace";
import { StatusBadge } from "./sales-page";

type Json<T> = T extends Date
  ? string
  : T extends Prisma.Decimal
    ? string
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
type Data = Json<Workspace>;

const fmt = (v: unknown) =>
  Number(String(v ?? 0)).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const time = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** Last 7 India-time dates, oldest first, as YYYY-MM-DD. */
function lastWeek() {
  const today = new Date(Date.now() + 330 * 60000);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getTime() - (6 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
}

export default function SalesDashboard({
  data,
  openSales,
}: {
  data: Data;
  openSales: (query?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const stats = data.salesStats;
  const team = new Map(data.team.map((m) => [m.id, m]));
  const days = lastWeek().map((day) => {
    const row = stats.week.find((w) => w.day === day);
    return { day, orders: row?.orders ?? 0, pieces: Number(row?.pieces ?? 0) };
  });
  const max = Math.max(1, ...days.map((d) => d.pieces));
  const today = [...stats.today].sort(
    (a, b) => Number(b.pieces) - Number(a.pieces),
  );
  const st = (k: string) => stats.statuses[k] ?? 0;

  return (
    <>
      <section className="panel">
        <h2>Sales today</h2>
        <form
          className="order-search"
          onSubmit={(e) => {
            e.preventDefault();
            openSales(query.trim());
          }}
        >
          <label className="branch-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Find order by ID, e.g. TRL1023"
              aria-label="Find order by ID"
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
            />
          </label>
          <button className="secondary" disabled={!query.trim()}>
            Find order
          </button>
        </form>
        <div className="quantity-cards">
          {[
            ["Orders today", String(stats.todayOrders)],
            ["Pieces sold today", fmt(stats.todayPieces)],
            ["Open orders (placed + dispatched)", String(st("PLACED") + st("DISPATCHED"))],
            [
              "Returned / damaged / cancelled",
              String(st("RETURNED") + st("DAMAGED") + st("CANCELLED")),
            ],
          ].map(([label, value]) => (
            <section className="panel" key={label}>
              <p className="muted small">{label}</p>
              <strong className="quantity-number">{value}</strong>
            </section>
          ))}
        </div>
      </section>

      <div className="dashboard-split">
        <section className="panel">
          <h2>Pieces sold — last 7 days</h2>
          <div className="chart" role="img" aria-label="Pieces sold per day for the last 7 days">
            {days.map((d) => (
              <div className="chart-group" key={d.day} title={`${d.day}: ${d.pieces} pcs, ${d.orders} orders`}>
                <span className="chart-value small">{fmt(d.pieces)}</span>
                <div
                  className="chart-bar"
                  style={{ height: `${(d.pieces / max) * 85}%` }}
                />
                <span className="chart-label">
                  {new Date(d.day + "T00:00:00Z").toLocaleDateString("en-IN", {
                    weekday: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Today by salesperson</h2>
          {today.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Salesperson</th>
                    <th>Orders</th>
                    <th>Pieces</th>
                  </tr>
                </thead>
                <tbody>
                  {today.map((r) => {
                    const m = team.get(r.teamMemberId);
                    return (
                      <tr key={r.teamMemberId}>
                        <td>
                          <strong>{m?.code}</strong> {m?.name}
                        </td>
                        <td>{r.orders}</td>
                        <td>{fmt(r.pieces)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">No sales yet today.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>Recent orders</h2>
          <button className="secondary" onClick={() => openSales()}>
            All sales
          </button>
        </div>
        {data.orders.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Status</th>
                  <th>Salesperson</th>
                  <th>Pieces</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.slice(0, 6).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <button
                        className="link-button"
                        onClick={() => openSales(o.orderNo)}
                      >
                        {o.orderNo}
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td>
                      {o.teamMember.code} · {o.teamMember.name}
                    </td>
                    <td>
                      {fmt(o.items.reduce((n, i) => n + Number(i.quantity), 0))}
                    </td>
                    <td>{time(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No orders yet.</p>
        )}
      </section>
    </>
  );
}
