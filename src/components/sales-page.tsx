"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FolderOpen,
  Minus,
  Pencil,
  Plus,
  ScanLine,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import type { Prisma } from "@prisma/client";
import type { Workspace } from "@/lib/workspace";
import {
  normalizeOrderNo,
  OPEN_STATUSES,
  ORDER_STATUSES,
  orderPrefix,
  STATUS_LABELS,
  stockNote,
  suggestTeamCode,
  TEAM_CODE,
  type OrderStatus,
} from "@/lib/order-id";

const Scanner = dynamic(() => import("./scanner"), { ssr: false });

type Json<T> = T extends Date
  ? string
  : T extends Prisma.Decimal
    ? string
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
export type Data = Json<Workspace>;
export type Order = Data["orders"][number];
type Status = { kind: "ok" | "error" | "info"; text: string } | null;

const CENTRAL = "CENTRAL";
export const fmt = (v: unknown) =>
  Number(String(v ?? 0)).toLocaleString("en-IN", { maximumFractionDigits: 3 });
export const when = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

export async function api(method: "GET" | "POST", url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) location.assign("/login");
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Unable to save");
  return result;
}

// Short beep so the user knows a scan landed without looking at the screen.
function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1200 : 300;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
    osc.onended = () => void ctx.close();
  } catch {}
}

export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog native-dialog wide"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="section-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export const statusLabel = (s: string) =>
  STATUS_LABELS[s as OrderStatus] ?? s;

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`tag status-${status.toLowerCase()}`}>
      {statusLabel(status)}
    </span>
  );
}

export function SalesPage({
  data,
  saved,
  initialQuery = "",
}: {
  data: Data;
  saved: () => Promise<void> | void;
  initialQuery?: string;
}) {
  const admin = data.user.role === "ADMIN";
  const [ownerId, setOwnerId] = useState(admin ? CENTRAL : data.user.id);
  const [orderInput, setOrderInput] = useState("");
  const [activeNo, setActiveNo] = useState("");
  const [current, setCurrent] = useState<Order | null>(null);
  const [code, setCode] = useState("");
  // Pieces the next scan adds; goes back to 1 after each scan.
  const [qty, setQty] = useState("1");
  const qtyRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pending, setPending] = useState(0);
  const [editing, setEditing] = useState<Order | null>(null);
  const [camera, setCamera] = useState<"order" | "product" | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [statusFilter, setStatusFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [results, setResults] = useState<Order[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLElement>(null);
  const orderRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);

  const team = useMemo(
    () => new Map(data.team.map((m) => [m.code, m])),
    [data.team],
  );
  const products = useMemo(
    () => new Map(data.products.map((p) => [p.id, p])),
    [data.products],
  );
  const productCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const p of data.products) {
      if (p.barcode) codes.add(p.barcode);
      if (p.sku) codes.add(p.sku);
    }
    return codes;
  }, [data.products]);
  const branches = data.users.filter(
    (u) => u.role === "BRANCH_MANAGER" && u.active,
  );
  const ownerName = (id: string) =>
    id === CENTRAL
      ? "Central warehouse"
      : data.users.find((u) => u.id === id)?.email || "My branch";
  const productName = (id: string) => products.get(id)?.name || id;

  const activeRef = useRef("");
  useEffect(() => {
    if (initialQuery) searchRef.current?.scrollIntoView({ behavior: "smooth" });
    else orderRef.current?.focus();
  }, [initialQuery]);

  // Search runs shortly after typing stops, and whenever a filter changes.
  const searchSeq = useRef(0);
  const runSearch = useMemo(
    () => async (q: string, status: string, member: string) => {
      if (!q.trim() && !status && !member) {
        setResults(null);
        return;
      }
      const seq = ++searchSeq.current;
      setSearching(true);
      try {
        const params = new URLSearchParams({ search: "1", q, status, member });
        const { orders } = (await api("GET", `/api/orders?${params}`)) as {
          orders: Order[];
        };
        if (seq === searchSeq.current) setResults(orders);
      } catch (e) {
        if (seq === searchSeq.current) toast.error((e as Error).message);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [],
  );
  useEffect(() => {
    const t = setTimeout(
      () => void runSearch(query, statusFilter, memberFilter),
      300,
    );
    return () => clearTimeout(t);
  }, [query, statusFilter, memberFilter, runSearch]);
  const refreshSearch = () => runSearch(query, statusFilter, memberFilter);
  // The product box is disabled until an order is set, so focus after render.
  useEffect(() => {
    activeRef.current = activeNo;
    if (activeNo) codeRef.current?.focus();
  }, [activeNo]);

  /** Validates the order ID, loads it if it exists, then moves to the product box. */
  async function openOrder(raw: string) {
    const no = normalizeOrderNo(raw);
    if (!no) return;
    const prefix = orderPrefix(no);
    if (!prefix) {
      beep(false);
      setStatus({
        kind: "error",
        text: `"${no}" is not a valid order ID. Use team code + number, e.g. TRL1023.`,
      });
      orderRef.current?.select();
      return;
    }
    const member = team.get(prefix);
    if (!member || !member.active) {
      beep(false);
      setStatus({
        kind: "error",
        text: member
          ? `Team member ${prefix} is disabled.`
          : `No team member has code ${prefix}. Add them on the Team page first.`,
      });
      orderRef.current?.select();
      return;
    }
    try {
      const { order } = (await api(
        "GET",
        `/api/orders?no=${encodeURIComponent(no)}`,
      )) as { order: Order | null };
      setCurrent(order);
      setActiveNo(no);
      setOrderInput(no);
      setCode("");
      setStatus({
        kind: "info",
        text: order
          ? `Order ${no} (${member.name}) opened — scan more products to add.`
          : `New order ${no} for ${member.name} — scan products.`,
      });
      codeRef.current?.focus();
    } catch (e) {
      beep(false);
      setStatus({ kind: "error", text: (e as Error).message });
      orderRef.current?.select();
    }
  }

  function newOrder() {
    setActiveNo("");
    setCurrent(null);
    setOrderInput("");
    setCode("");
    setStatus(null);
    orderRef.current?.focus();
  }

  /** Each scan saves immediately; scans are queued so they apply in order. */
  function scan(raw: string) {
    let value = raw.trim();
    setCode("");
    codeRef.current?.focus();
    if (!value) return;
    // "12*barcode" adds 12 pieces; otherwise use the Qty box.
    let pieces = qty.trim() || "1";
    const multi = /^(\d{1,9}(?:\.\d{1,3})?)\s*\*\s*(.+)$/.exec(value);
    if (multi) {
      pieces = multi[1];
      value = multi[2].trim();
    }
    if (!/^\d{1,9}(\.\d{1,3})?$/.test(pieces) || Number(pieces) <= 0) {
      beep(false);
      setStatus({ kind: "error", text: "Quantity must be a number above 0." });
      qtyRef.current?.select();
      return;
    }
    setQty("1");
    if (!activeNo) {
      setStatus({ kind: "error", text: "Enter or scan the order ID first." });
      orderRef.current?.focus();
      return;
    }
    // A scanned order ID in the product box starts the next order.
    const prefix = orderPrefix(value);
    if (!productCodes.has(value) && prefix && team.has(prefix)) {
      void openOrder(value);
      return;
    }
    const orderNo = activeNo;
    inFlight.current++;
    setPending(inFlight.current);
    queue.current = queue.current.then(async () => {
      try {
        const result = (await api("POST", "/api/orders", {
          action: "scan",
          orderNo,
          ownerId,
          code: value,
          quantity: pieces,
        })) as { order: Order; product: { id: string; name: string } };
        // Ignore late results if the user already moved to another order.
        if (activeRef.current === orderNo) setCurrent(result.order);
        const line = result.order.items.find(
          (i) => i.productId === result.product.id,
        );
        beep(true);
        setStatus({
          kind: "ok",
          text: `Saved: +${fmt(pieces)} ${result.product.name} — now ${fmt(line?.quantity)} in ${orderNo}`,
        });
      } catch (e) {
        beep(false);
        setStatus({ kind: "error", text: (e as Error).message });
      } finally {
        inFlight.current--;
        setPending(inFlight.current);
        if (inFlight.current === 0) void saved();
      }
    });
  }

  async function update(order: Order, items: { productId: string; quantity: string }[], orderNo = order.orderNo) {
    const result = (await api("POST", "/api/orders", {
      action: "update",
      id: order.id,
      orderNo,
      items,
    })) as { order: Order | null };
    if (current?.id === order.id) {
      setCurrent(result.order);
      if (result.order) {
        setActiveNo(result.order.orderNo);
        setOrderInput(result.order.orderNo);
      }
    }
    await saved();
    void refreshSearch();
    return result.order;
  }

  async function setQuantity(order: Order, productId: string, quantity: string) {
    try {
      await update(
        order,
        order.items.map((i) => ({
          productId: i.productId,
          quantity: i.productId === productId ? quantity : i.quantity,
        })),
      );
      setStatus({ kind: "ok", text: `Updated ${productName(productId)}` });
    } catch (e) {
      beep(false);
      setStatus({ kind: "error", text: (e as Error).message });
    }
    codeRef.current?.focus();
  }

  async function changeStatus(order: Order, status: string) {
    if (status === order.status) return;
    try {
      const result = (await api("POST", "/api/orders", {
        action: "status",
        id: order.id,
        status,
      })) as { order: Order };
      if (current?.id === order.id) setCurrent(result.order);
      toast.success(
        `${order.orderNo}: ${statusLabel(status)}${stockNote(order.status, status)}`,
      );
      await saved();
      void refreshSearch();
    } catch (e) {
      toast.error((e as Error).message, { duration: 8000 });
    }
  }

  function openInScanner(order: Order) {
    setOrderInput(order.orderNo);
    void openOrder(order.orderNo);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const orderCard = (o: Order) => (
    <article key={o.id} className="recent-order">
      <div>
        <strong>{o.orderNo}</strong> <StatusBadge status={o.status} />
        <div className="small muted">
          {o.teamMember.name} ({o.teamMember.code}) · {when(o.createdAt)}
          {admin && ` · ${ownerName(o.ownerId)}`}
        </div>
        {o.statusNote && (
          <div className="small muted">Note: {o.statusNote}</div>
        )}
      </div>
      <ul className="small">
        {o.items.map((i) => (
          <li key={i.id}>
            {productName(i.productId)}: <strong>{fmt(i.quantity)}</strong>
          </li>
        ))}
      </ul>
      <div className="order-actions">
        <label className="small">
          Status
          <select
            value={o.status}
            onChange={(e) => void changeStatus(o, e.target.value)}
          >
            {ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          {OPEN_STATUSES.includes(o.status) && (
            <button
              className="secondary"
              title="Open in scanner to add products"
              onClick={() => openInScanner(o)}
            >
              <FolderOpen size={15} /> Open
            </button>
          )}
          <button className="secondary" onClick={() => setEditing(o)}>
            <Pencil size={15} /> Edit
          </button>
          <button className="danger" onClick={() => void remove(o)}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </article>
  );

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
      if (current?.id === order.id) newOrder();
      await saved();
      void refreshSearch();
      toast.success(`Order ${order.orderNo} deleted`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const activeMember = activeNo ? team.get(orderPrefix(activeNo) || "") : null;
  const pieces = (o: Order) =>
    o.items.reduce((n, i) => n + Number(i.quantity), 0);
  const recent = data.orders.slice(0, 3);
  return (
    <>
      <div className="sales-layout">
      <section className="panel sales-entry">
        <div className="section-head">
          <h2>Sale entry</h2>
          <a className="export-link" href="/api/export?type=orders">
            Download orders Excel
          </a>
        </div>
        {!data.team.length && (
          <p className="error" role="alert">
            {admin
              ? "Add team members on the Team page first. Order IDs must start with a team member's code."
              : "No team members yet. Ask admin to add team members and their codes."}
          </p>
        )}
        <div className="form-grid sales-inputs">
          {admin && (
            <label>
              Sell from
              <select
                value={current ? current.ownerId : ownerId}
                disabled={!!current}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value={CENTRAL}>Central warehouse</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    Branch: {b.email}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            1. Order ID
            <div className="scan-field">
              <input
                ref={orderRef}
                className="scan-input"
                value={orderInput}
                placeholder="Type or scan, e.g. TRL1023"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setOrderInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") {
                    if (!orderInput.trim()) return;
                    e.preventDefault();
                    void openOrder(orderInput);
                  }
                }}
              />
              <button
                type="button"
                className="secondary icon-button"
                aria-label="Scan order ID with camera"
                onClick={() => setCamera("order")}
              >
                <ScanLine size={18} />
              </button>
            </div>
            <span className="small muted">
              {activeMember
                ? `Salesperson: ${activeMember.name} (${activeMember.code})`
                : `Codes: ${data.team.filter((m) => m.active).map((m) => m.code).join(", ") || "none"}`}
            </span>
          </label>
          <label className="product-field">
            2. Quantity × product barcode / SKU
            <div className="scan-field">
              <input
                ref={qtyRef}
                className="scan-input qty-input"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={qty}
                disabled={!activeNo}
                aria-label="Quantity for next scan"
                title="Pieces added by the next scan"
                onChange={(e) => setQty(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    codeRef.current?.focus();
                  }
                }}
              />
              <span aria-hidden className="muted">×</span>
              <input
                ref={codeRef}
                className="scan-input"
                value={code}
                disabled={!activeNo}
                placeholder={
                  activeNo ? "Scan product — saves instantly" : "Enter order ID first"
                }
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    scan(code);
                  }
                  if (e.key === "Escape") newOrder();
                }}
              />
              <button
                type="button"
                className="secondary icon-button"
                aria-label="Scan product with camera"
                disabled={!activeNo}
                onClick={() => setCamera("product")}
              >
                <ScanLine size={18} />
              </button>
            </div>
            <span className="small muted">
              {pending
                ? `Saving ${pending}…`
                : "Set Qty first for many pieces (or type 12*barcode). Scanning the next order ID starts a new order. Esc = new order."}
            </span>
          </label>
        </div>
        <p
          className={`sales-status ${status?.kind ?? ""}`}
          role="status"
          aria-live="polite"
        >
          {status?.text ?? "Scan or type an order ID and press Enter."}
        </p>
        {activeNo && (
          <div className="sales-current">
            <div className="section-head">
              <h3>
                {activeNo}{" "}
                {current && <StatusBadge status={current.status} />}{" "}
                <span className="small muted">
                  {current
                    ? `· ${ownerName(current.ownerId)} · ${current.items.length} products · ${fmt(pieces(current))} pcs`
                    : "· nothing scanned yet"}
                </span>
              </h3>
              <button className="secondary" onClick={newOrder}>
                Next order
              </button>
            </div>
            {current && (
              <OrderLines
                order={current}
                productName={productName}
                setQuantity={setQuantity}
              />
            )}
          </div>
        )}
      </section>

      <aside className="panel sales-recent">
        <h2>Last 3 entries</h2>
        {!recent.length && <p className="empty">No sales recorded yet</p>}
        <div className="recent-orders">{recent.map(orderCard)}</div>
      </aside>
      </div>

      <section className="panel" ref={searchRef}>
        <h2>Find order</h2>
        <div className="order-search">
          <label className="branch-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Order ID or part of it, e.g. TRL10"
              aria-label="Search by order ID"
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
            />
          </label>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABELS[st]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by salesperson"
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
          >
            <option value="">All salespeople</option>
            {data.team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </select>
        </div>
        {results === null ? (
          <p className="small muted">
            Type an order ID, or choose a status or salesperson, to see orders.
          </p>
        ) : searching && !results.length ? (
          <p className="small muted">Searching…</p>
        ) : !results.length ? (
          <p className="empty">No orders match.</p>
        ) : (
          <>
            <p className="small muted">
              {results.length === 50
                ? "Showing the latest 50 matches"
                : `${results.length} order(s)`}
            </p>
            <div className="recent-orders">{results.map(orderCard)}</div>
          </>
        )}
      </section>

      {editing && (
        <EditOrder
          order={editing}
          productName={productName}
          close={() => setEditing(null)}
          save={async (orderNo, items) => {
            await update(editing, items, orderNo);
            toast.success("Order updated");
            setEditing(null);
          }}
        />
      )}
      {camera && (
        <Scanner
          actionLabel={camera === "order" ? "Use order ID" : "Add product"}
          continuous={camera === "product"}
          onScan={(value) => {
            if (camera === "order") {
              setCamera(null);
              setOrderInput(value.toUpperCase());
              void openOrder(value);
            } else scan(value);
          }}
          onClose={() => setCamera(null)}
        />
      )}
    </>
  );
}

function OrderLines({
  order,
  productName,
  setQuantity,
}: {
  order: Order;
  productName: (id: string) => string;
  setQuantity: (order: Order, productId: string, quantity: string) => Promise<void>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => {
            const q = Number(i.quantity);
            return (
              <tr key={i.id}>
                <td>{productName(i.productId)}</td>
                <td>
                  <div className="qty-stepper">
                    <button
                      type="button"
                      className="secondary icon-button"
                      aria-label="Decrease quantity"
                      onClick={() =>
                        void setQuantity(order, i.productId, q > 1 ? String(q - 1) : "0")
                      }
                    >
                      <Minus size={15} />
                    </button>
                    <input
                      key={i.quantity}
                      className="line-qty"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue={Number(i.quantity)}
                      aria-label={`Quantity of ${productName(i.productId)}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim();
                        if (v === "" || Number(v) === q) {
                          e.currentTarget.value = String(q);
                          return;
                        }
                        void setQuantity(order, i.productId, Number(v) <= 0 ? "0" : v);
                      }}
                    />
                    <button
                      type="button"
                      className="secondary icon-button"
                      aria-label="Increase quantity"
                      onClick={() => void setQuantity(order, i.productId, String(q + 1))}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    className="danger icon-button"
                    aria-label={`Remove ${productName(i.productId)}`}
                    onClick={() => void setQuantity(order, i.productId, "0")}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EditOrder({
  order,
  productName,
  close,
  save,
}: {
  order: Order;
  productName: (id: string) => string;
  close: () => void;
  save: (
    orderNo: string,
    items: { productId: string; quantity: string }[],
  ) => Promise<void>;
}) {
  const [orderNo, setOrderNo] = useState(order.orderNo);
  const [items, setItems] = useState(
    order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={`Edit order ${order.orderNo}`} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await save(
              normalizeOrderNo(orderNo),
              items.map((i) => ({
                productId: i.productId,
                quantity: !i.quantity || Number(i.quantity) <= 0 ? "0" : i.quantity,
              })),
            );
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          Order ID
          <input
            value={orderNo}
            required
            maxLength={64}
            onChange={(e) => setOrderNo(e.target.value.toUpperCase())}
          />
        </label>
        <div className="table-wrap" style={{ margin: "16px 0" }}>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={i.productId}>
                  <td>{productName(i.productId)}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={i.quantity}
                      aria-label={`Quantity of ${productName(i.productId)}`}
                      onChange={(e) =>
                        setItems((all) =>
                          all.map((x, k) =>
                            k === n ? { ...x, quantity: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="danger icon-button"
                      aria-label={`Remove ${productName(i.productId)}`}
                      onClick={() =>
                        setItems((all) => all.filter((_, k) => k !== n))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <p className="error small">
              All products removed — saving will delete this order.
            </p>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function TeamPage({
  data,
  saved,
}: {
  data: Data;
  saved: () => Promise<void> | void;
}) {
  type Member = Data["team"][number];
  const [selected, setSelected] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stats = (id: string) =>
    data.teamSummary.find((s) => s.teamMemberId === id);
  const codeRef = useRef<HTMLInputElement>(null);
  const codeTouched = useRef(false);
  async function remove(m: Member) {
    if (!confirm(`Delete team member ${m.name} (${m.code})? This cannot be undone.`))
      return;
    try {
      await api("POST", "/api/team", { action: "delete", id: m.id });
      if (selected?.id === m.id) setSelected(null);
      toast.success(`Deleted ${m.name}`);
      await saved();
    } catch (e) {
      toast.error((e as Error).message, { duration: 8000 });
    }
  }
  return (
    <section className="panel">
      <div className="section-head">
        <h2>Sales team</h2>
        <span className="tag">Admin only</span>
      </div>
      <p className="small muted">
        Each team member gets a short letter code. Order IDs start with that
        code followed by numbers — for example code <strong>TRL</strong> →
        order <strong>TRL1023</strong> — so every order shows who made the sale.
      </p>
      <div className="table-wrap" style={{ margin: "20px 0" }}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Orders / pieces</th>
              <th>Manage</th>
            </tr>
          </thead>
          <tbody>
            {data.team.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.code}</strong>
                </td>
                <td>{m.name}</td>
                <td>{m.phone || "—"}</td>
                <td>{m.active ? "Active" : "Disabled"}</td>
                <td>
                  {stats(m.id)?.orders ?? 0} / {fmt(stats(m.id)?.pieces ?? 0)}
                </td>
                <td>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() => {
                        codeTouched.current = true;
                        setSelected(m);
                      }}
                    >
                      <Pencil size={15} /> Edit
                    </button>
                    <button
                      className="danger icon-button"
                      aria-label={`Delete ${m.name}`}
                      title="Delete team member"
                      onClick={() => void remove(m)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.team.length && <p className="empty">No team members yet</p>}
      </div>
      <h3 style={{ marginBottom: 16 }}>
        {selected ? `Edit ${selected.name}` : "Add team member"}
      </h3>
      <form
        key={selected?.id || "new"}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const fd = new FormData(f);
          const code = String(fd.get("code") || "").trim().toUpperCase();
          if (!TEAM_CODE.test(code)) {
            setError("Code must be 1 to 10 letters, e.g. TRL");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await api("POST", "/api/team", {
              id: selected?.id,
              name: fd.get("name"),
              code,
              phone: fd.get("phone"),
              active: fd.get("active") === "on",
            });
            toast.success("Team member saved");
            setSelected(null);
            codeTouched.current = false;
            f.reset();
            await saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Name
            <input
              name="name"
              required
              maxLength={191}
              defaultValue={selected?.name}
              onChange={(e) => {
                // Suggest initials as the code until the user types one.
                if (!codeTouched.current && codeRef.current)
                  codeRef.current.value = suggestTeamCode(e.target.value);
              }}
            />
          </label>
          <label>
            Code (letters only)
            <input
              ref={codeRef}
              name="code"
              required
              onChange={() => {
                codeTouched.current = true;
              }}
              maxLength={10}
              pattern="[A-Za-z]{1,10}"
              placeholder="TRL"
              style={{ textTransform: "uppercase" }}
              defaultValue={selected?.code}
            />
          </label>
          <label>
            Phone (optional)
            <input name="phone" maxLength={64} defaultValue={selected?.phone ?? ""} />
          </label>
          <label className="check-label">
            <input
              name="active"
              type="checkbox"
              defaultChecked={selected?.active ?? true}
            />
            Active
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button disabled={busy}>
            {busy ? "Saving…" : selected ? "Save changes" : "Add team member"}
          </button>
          {selected && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                codeTouched.current = false;
                setSelected(null);
              }}
            >
              Cancel
            </button>
          )}
          {selected && (
            <button
              type="button"
              className="danger"
              onClick={() => void remove(selected)}
            >
              <Trash2 size={15} /> Delete team member
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
