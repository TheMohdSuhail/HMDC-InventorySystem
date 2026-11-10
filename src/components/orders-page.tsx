"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  OPEN_STATUSES,
  ORDER_STATUSES,
  STATUS_LABELS,
  stockNote,
} from "@/lib/order-id";
import {
  api,
  EditOrder,
  fmt,
  StatusBadge,
  statusLabel,
  when,
  type Data,
  type Order,
} from "./sales-page";

const CENTRAL = "CENTRAL";
const blank = { q: "", status: "", member: "", owner: "", from: "", to: "" };
type Filters = typeof blank;
type Result = {
  orders: Order[];
  total: number;
  pageSize: number;
  counts: Record<string, number>;
};

/** Every order in the user's scope, with status tabs, filters and paging. */
export default function OrdersPage({
  data,
  saved,
}: {
  data: Data;
  saved: () => Promise<void> | void;
}) {
  const admin = data.user.role === "ADMIN";
  const [filters, setFilters] = useState<Filters>(blank);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Order | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (f: Filters, p: number) => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ list: "1", ...f, page: String(p) });
      const r = (await api("GET", `/api/orders?${params}`)) as Result;
      if (n !== seq.current) return;
      // The last page can empty out after a delete or status change.
      if (!r.orders.length && p > 1) setPage(1);
      setResult(r);
      setError("");
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);
  // Reload shortly after typing stops, and whenever a filter or the page changes.
  useEffect(() => {
    const t = setTimeout(() => void load(filters, page), 250);
    return () => clearTimeout(t);
  }, [filters, page, load]);

  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const refresh = async () => {
    await saved();
    await load(filters, page);
  };
  const productName = (id: string) =>
    data.products.find((p) => p.id === id)?.name || id;
  const ownerName = (id: string) =>
    id === CENTRAL
      ? "Central warehouse"
      : data.users.find((u) => u.id === id)?.email || "My branch";
  const branches = data.users.filter((u) => u.role === "BRANCH_MANAGER");

  async function changeStatus(order: Order, status: string) {
    if (status === order.status) return;
    try {
      await api("POST", "/api/orders", { action: "status", id: order.id, status });
      toast.success(
        `${order.orderNo}: ${statusLabel(status)}${stockNote(order.status, status)}`,
      );
    } catch (e) {
      toast.error((e as Error).message, { duration: 8000 });
    }
    await refresh();
  }

  async function remove(order: Order) {
    if (
      !confirm(
        OPEN_STATUSES.includes(order.status)
          ? `Delete order ${order.orderNo}? Its ${order.items.length} product line(s) will go back to stock.`
          : `Delete order ${order.orderNo}? Its stock was already returned, so stock will not change.`,
      )
    )
      return;
    try {
      await api("POST", "/api/orders", { action: "delete", id: order.id });
      toast.success(`Order ${order.orderNo} deleted`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    await refresh();
  }

  const counts = result?.counts ?? {};
  const all = Object.values(counts).reduce((n, c) => n + c, 0);
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <section className="panel">
      <div className="section-head">
        <h2>All orders</h2>
        <a className="export-link" href="/api/export?type=orders">
          Download orders Excel
        </a>
      </div>
      <div className="order-tabs" role="group" aria-label="Filter by status">
        {["", ...ORDER_STATUSES].map((st) => (
          <button
            key={st || "all"}
            type="button"
            className={filters.status === st ? "selected" : ""}
            aria-pressed={filters.status === st}
            onClick={() => set({ status: st })}
          >
            {st ? STATUS_LABELS[st as keyof typeof STATUS_LABELS] : "All"}
            <span className="count">{st ? (counts[st] ?? 0) : all}</span>
          </button>
        ))}
      </div>
      <div className="order-filters">
        <label className="branch-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={filters.q}
            placeholder="Order ID or part of it, e.g. TRL10"
            aria-label="Search by order ID"
            onChange={(e) => set({ q: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="small">
          Salesperson
          <select
            value={filters.member}
            onChange={(e) => set({ member: e.target.value })}
          >
            <option value="">All</option>
            {data.team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </select>
        </label>
        {admin && (
          <label className="small">
            Location
            <select
              value={filters.owner}
              onChange={(e) => set({ owner: e.target.value })}
            >
              <option value="">All</option>
              <option value={CENTRAL}>Central warehouse</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.email}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="small">
          From
          <input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
          />
        </label>
        <label className="small">
          To
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
          />
        </label>
        {filtered && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setFilters(blank);
              setPage(1);
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!result ? (
        !error && <p className="small muted">Loading orders…</p>
      ) : !result.orders.length ? (
        <p className="empty">
          {filtered ? "No orders match these filters." : "No orders yet."}
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Date</th>
                  <th>Salesperson</th>
                  {admin && <th>Location</th>}
                  <th>Products</th>
                  <th>Pieces</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {result.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.orderNo}</strong>
                      <div>
                        <StatusBadge status={o.status} />
                      </div>
                    </td>
                    <td>{when(o.createdAt)}</td>
                    <td>
                      {o.teamMember.name} ({o.teamMember.code})
                    </td>
                    {admin && <td>{ownerName(o.ownerId)}</td>}
                    <td>
                      <ul className="small">
                        {o.items.map((i) => (
                          <li key={i.id}>
                            {productName(i.productId)}: <strong>{fmt(i.quantity)}</strong>
                          </li>
                        ))}
                      </ul>
                      {o.statusNote && (
                        <div className="small muted">Note: {o.statusNote}</div>
                      )}
                    </td>
                    <td>
                      {fmt(o.items.reduce((n, i) => n + Number(i.quantity), 0))}
                    </td>
                    <td>
                      <select
                        aria-label={`Status of ${o.orderNo}`}
                        value={o.status}
                        onChange={(e) => void changeStatus(o, e.target.value)}
                      >
                        {ORDER_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {STATUS_LABELS[st]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="actions">
                        <button
                          className="secondary icon-button"
                          aria-label={`Edit ${o.orderNo}`}
                          title="Edit order"
                          onClick={() => setEditing(o)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="danger icon-button"
                          aria-label={`Delete ${o.orderNo}`}
                          title={
                            o.status === "DAMAGED"
                              ? "Damaged orders cannot be deleted — change the status first"
                              : "Delete order"
                          }
                          disabled={o.status === "DAMAGED"}
                          onClick={() => void remove(o)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="order-pager">
            <span className="small muted">
              {loading
                ? "Loading…"
                : `Showing ${(page - 1) * result.pageSize + 1}–${(page - 1) * result.pageSize + result.orders.length} of ${result.total} order(s)`}
            </span>
            {pages > 1 && (
              <div className="actions">
                <button
                  className="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span className="small">
                  Page {page} of {pages}
                </span>
                <button
                  className="secondary"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {editing && (
        <EditOrder
          order={editing}
          productName={productName}
          close={() => setEditing(null)}
          save={async (orderNo, items) => {
            await api("POST", "/api/orders", {
              action: "update",
              id: editing.id,
              orderNo,
              items,
            });
            toast.success("Order updated");
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}
