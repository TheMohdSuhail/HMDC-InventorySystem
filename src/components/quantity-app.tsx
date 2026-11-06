"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import {
  Boxes,
  LayoutDashboard,
  Package,
  Users,
  Factory,
  ClipboardList,
  Truck,
  Settings,
  LogOut,
  ScanLine,
  X,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import Accounts from "./accounts";
import InventorySkeleton from "./inventory-skeleton";
import FilterBar from "./filter-bar";
import {
  expiryRangeError,
  filterInventory,
  indiaBusinessDate,
  initialInventoryFilterState,
  inventoryFilterReducer,
  matchesExpiry,
  defaultInventoryFilters,
  type InventoryFilters,
} from "@/lib/filters";
import DashboardInsights from "./dashboard-insights";
import type { Workspace } from "@/lib/workspace";
import type { QuantityInput } from "@/lib/quantity";
import { D } from "@/lib/math";
import type { Prisma } from "@prisma/client";
const Scanner = dynamic(() => import("./scanner"), { ssr: false });
const BulkProducts = dynamic(() => import("./bulk-products"), { ssr: false });
type Json<T> = T extends Date
  ? string
  : T extends Prisma.Decimal
    ? string
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
type Data = Json<Workspace>;
type Product = Data["products"][number];
type Event = Data["events"][number];
type Mode = QuantityInput["type"] | "PURCHASE" | "PO_RECEIVE" | "LEGACY_RETURN";
const titles: Record<Mode, string> = {
  ASSIGN: "Send stock to branch",
  BRANCH_RETURN: "Return branch stock to warehouse",
  READY: "Record finished stock",
  DISPATCH: "Send stock to warehouse",
  RECEIVE: "Receive stock from manufacturer",
  SALE: "Record sale",
  RETURN: "Record customer return",
  STOCK_IN: "Add stock to warehouse",
  LOSS: "Record stock loss",
  DAMAGED: "Mark stock as damaged",
  EXPIRED: "Mark stock as expired",
  QUARANTINED: "Put stock on hold",
  RELEASE: "Make held stock available",
  DISPOSE_DAMAGED: "Permanently remove damaged stock",
  DISPOSE_EXPIRED: "Permanently remove expired stock",
  DISPOSE_QUARANTINED: "Permanently remove held stock",
  PURCHASE: "Create purchase order",
  PO_RECEIVE: "Receive stock from supplier",
  LEGACY_RETURN: "Record return from old sales records",
};
const confirmLabels: Record<Mode, string> = {
  ASSIGN: "Confirm stock transfer to branch",
  BRANCH_RETURN: "Confirm stock return to warehouse",
  READY: "Save finished stock",
  DISPATCH: "Confirm stock sent to warehouse",
  RECEIVE: "Confirm receipt from manufacturer",
  STOCK_IN: "Confirm stock addition",
  SALE: "Save sale",
  RETURN: "Save customer return",
  LOSS: "Confirm stock loss",
  DAMAGED: "Confirm damaged stock",
  EXPIRED: "Confirm expired stock",
  QUARANTINED: "Confirm stock on hold",
  RELEASE: "Confirm stock available for sale",
  DISPOSE_DAMAGED: "Permanently remove damaged stock",
  DISPOSE_EXPIRED: "Permanently remove expired stock",
  DISPOSE_QUARANTINED: "Permanently remove held stock",
  PURCHASE: "Save purchase order",
  PO_RECEIVE: "Confirm receipt from supplier",
  LEGACY_RETURN: "Save return from old sales records",
};
const fmt = (v: unknown) =>
  Number(String(v ?? 0)).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const date = (s: string) =>
  new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
async function post(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (r.status === 401) location.assign("/login");
  if (!r.ok) throw new Error(result.error || "Unable to save");
  return result;
}
function Modal({
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
export default function QuantityApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [page, setPage] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [visibleProducts, setVisibleProducts] = useState(50);
  const [inventoryFilterState, dispatchInventoryFilter] = useReducer(
    inventoryFilterReducer, initialInventoryFilterState,
  );
  const [mode, setMode] = useState<Mode | null>(null);
  const [product, setProduct] = useState<Product | "new" | null>(null);
  const [manufacturerProduct, setManufacturerProduct] = useState(false);
  const [supplier, setSupplier] = useState(false);
  const [bulk, setBulk] = useState<"import" | "scan" | null>(null);
  const [camera, setCamera] = useState(false);
  async function logout() {
    setLoggingOut(true);
    try {
      const r = await fetch("/api/auth", { method: "DELETE" });
      if (!r.ok && r.status !== 401)
        throw new Error("Unable to log out. Please try again.");
      location.replace("/login");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to log out");
      setLoggingOut(false);
    }
  }
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/data", { cache: "no-store" });
      if (r.status === 401) {
        location.assign("/login");
        return;
      }
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setData(result);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load inventory");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const h = location.hash.slice(1);
    if (h) setPage(decodeURIComponent(h));
  }, []);
  if (!data && !error) return <InventorySkeleton />;
  if (!data)
    return (
      <main className="content">
        <h1>Herbal Maza Inventory</h1>
        {error ? (
          <>
            <p role="alert" className="error">
              {error}
            </p>
            <button onClick={() => void load()}>Retry</button>
          </>
        ) : (
          <p role="status">Loading inventory…</p>
        )}
      </main>
    );
  const branch = data.user.role === "BRANCH_MANAGER";
  const admin = data.user.role === "ADMIN",
    manufacturer = data.user.role === "MANUFACTURER";
  const nav = manufacturer
    ? [{ name: "Production", icon: Factory }]
    : [
        { name: "Dashboard", icon: LayoutDashboard },
        { name: "Inventory", icon: Package },
        ...(admin ? [{ name: "Branches", icon: Users }] : []),
        ...(admin ? [{ name: "Production", icon: Factory }] : []),
        { name: "Operations", icon: ClipboardList },
        ...(admin
          ? [
              { name: "Purchases", icon: Truck },
              { name: "Suppliers", icon: Users },
            ]
          : []),
        { name: "Reports", icon: ClipboardList },
        { name: "Settings", icon: Settings },
      ];
  const safePage = nav.some((n) => n.name === page)
    ? page
    : manufacturer
      ? "Production"
      : "Dashboard";
  const inventoryPage = safePage === "Inventory";
  const today = indiaBusinessDate();
  const filters = inventoryFilterState.filters;
  const changeFilters = (patch: Partial<InventoryFilters>) =>
    dispatchInventoryFilter({ type: "change", patch });
  const expiryLabels = {
    all: "All expiry dates", expired: "Already expired", "30": "Next 30 days",
    "60": "Next 60 days", "90": "Next 90 days", custom: "Custom range", unset: "Expiry not set",
  };
  const stockLabels = { all: "All stock", in: "In stock", low: "Low", out: "Out" };
  const chips: { id: string; label: string; remove: () => void }[] = [];
  if (filters.search) chips.push({ id: "search", label: `Search: ${filters.search}`, remove: () => changeFilters({ search: "" }) });
  if (filters.category) chips.push({ id: "category", label: `Category: ${filters.category}`, remove: () => changeFilters({ category: "" }) });
  if (filters.stock !== "all") chips.push({ id: "stock", label: `Stock: ${stockLabels[filters.stock]}`, remove: () => changeFilters({ stock: "all" }) });
  if (filters.expiry !== "all") chips.push({ id: "expiry", label: filters.expiry === "custom" ? `Expiry: ${filters.from || "start"} to ${filters.to || "end"}` : expiryLabels[filters.expiry], remove: () => changeFilters({ expiry: "all", from: "", to: "" }) });
  if (filters.active !== "all") chips.push({ id: "active", label: filters.active === "active" ? "Active products" : "Archived products", remove: () => changeFilters({ active: "all" }) });
  const categories = [...new Set(data.products.map((p) => p.category).filter((category): category is string => !!category))].sort((a, b) => a.localeCompare(b));
  const visibleCount = inventoryPage ? inventoryFilterState.visibleCount : visibleProducts;
  const filtered = inventoryPage ? filterInventory(
    data.products, inventoryFilterState.appliedFilters, data.settings.minStock, today,
  ) : data.products.filter((p) =>
    [p.name, p.sku, p.barcode, p.category].some((v) =>
      v?.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const names = (id: string) =>
    data.products.find((p) => p.id === id)?.name || id;
  const owner = (id: string) =>
    id === "CENTRAL"
      ? "Central warehouse"
      : data.users.find((u) => u.id === id)?.email || "My inventory";
  const inTransit = data.events
    .filter((e) => e.type === "DISPATCH")
    .reduce(
      (n, e) =>
        n +
        e.items.reduce(
          (s, i) => s + Number(i.quantity) - Number(i.processed),
          0,
        ),
      0,
    );
  const dashboardProducts = data.products.filter(
    (p): p is (typeof data.products)[number] & { stock: string } =>
      typeof p.stock === "string",
  );
  const inventory = (
    <section className="panel">
      <div className="section-head">
        <h2>
          {admin
            ? "Central warehouse"
            : manufacturer
              ? "My ready inventory"
              : "My assigned inventory"}
        </h2>
        <a className="export-link" href="/api/export?type=products">
          Download inventory Excel
        </a>
      </div>
      {inventoryPage ? (
        <FilterBar
          search={filters.search}
          onSearch={(value) => changeFilters({ search: value })}
          searchAction={<button type="button" className="secondary" onClick={() => setCamera(true)}><ScanLine size={17} />Find product by barcode</button>}
          chips={chips}
          clear={() => dispatchInventoryFilter({ type: "clear" })}
          count={filtered.length}
          total={data.products.length}
          error={expiryRangeError(filters)}
        >
          <label>Category
            <select value={filters.category} onChange={(e) => changeFilters({ category: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>Stock status
            <select value={filters.stock} onChange={(e) => changeFilters({ stock: e.target.value as InventoryFilters["stock"] })}>
              {Object.entries(stockLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Expiry
            <select value={filters.expiry} onChange={(e) => changeFilters({ expiry: e.target.value as InventoryFilters["expiry"] })}>
              {(["all", "expired", "30", "60", "90", "custom", "unset"] as const).map((value) => <option key={value} value={value}>{expiryLabels[value]}</option>)}
            </select>
          </label>
          {filters.expiry === "custom" && <>
            <label>Expiry from<input type="date" value={filters.from} onChange={(e) => changeFilters({ from: e.target.value })} /></label>
            <label>Expiry to<input type="date" value={filters.to} onChange={(e) => changeFilters({ to: e.target.value })} /></label>
          </>}
          <label>Product status
            <select value={filters.active} onChange={(e) => changeFilters({ active: e.target.value as InventoryFilters["active"] })}>
              <option value="all">Active and archived</option>
              <option value="active">Active only</option>
              <option value="archived">Archived only</option>
            </select>
          </label>
          {!admin && <p className="muted small">Low stock uses the business default minimum of {fmt(data.settings.minStock)}.</p>}
        </FilterBar>
      ) : <div className="filters quantity-search">
        <input
          aria-label="Search inventory or scan barcode"
          placeholder="Search name, SKU or scan barcode + Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.select();
          }}
        />
        <button className="secondary" onClick={() => setCamera(true)}>
          <ScanLine size={17} />
          Find product by barcode
        </button>
      </div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Barcode / SKU</th>
              <th>{manufacturer ? "Ready pieces" : "Available quantity"}</th>
              <th>Unit</th>
              <th>Expiry date</th>
              {(admin || branch) && (
                <>
                  <th>Damaged / Expired / On hold</th>
                  {admin && <th>Manage</th>}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, visibleCount).map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="small muted">
                    {p.category}
                    {!p.active && " · Archived"}
                    {admin &&
                      Number(p.stock) <= Number(p.minStock) &&
                      " · Low stock"}
                  </div>
                </td>
                <td>
                  {p.barcode || "—"}
                  <div className="small muted">{p.sku}</div>
                </td>
                <td>{fmt(p.stock)}</td>
                <td>{p.unit}</td>
                <td>
                  {p.expiryDate ? (
                    <>
                      <span>{p.expiryDate.slice(0, 10)}</span>
                      {inventoryPage ? (
                        matchesExpiry(p.expiryDate, { ...defaultInventoryFilters, expiry: "expired" }, today)
                          ? <div className="error small">Expired</div>
                          : matchesExpiry(p.expiryDate, { ...defaultInventoryFilters, expiry: "30" }, today)
                            ? <div className="small">Expiring within 30 days</div> : null
                      ) : p.expiryDate.slice(0, 10) <
                      new Date(Date.now() + 330 * 60000)
                        .toISOString()
                        .slice(0, 10) ? (
                        <div className="error small">Expired</div>
                      ) : new Date(p.expiryDate).getTime() - Date.now() <
                        30 * 86400000 ? (
                        <div className="small">Expiring within 30 days</div>
                      ) : null}
                    </>
                  ) : (
                    "Not set"
                  )}
                </td>
                {(admin || branch) && (
                  <td>
                    {fmt(p.damaged)} / {fmt(p.expired)} / {fmt(p.quarantined)}
                  </td>
                )}
                {admin && (
                  <>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setProduct(p)}
                      >
                        Edit product
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > visibleCount && (
          <button
            className="secondary"
            onClick={() => inventoryPage ? dispatchInventoryFilter({ type: "more" }) : setVisibleProducts((n) => n + 50)}
          >
            Show 50 more products ({visibleCount} of {filtered.length})
          </button>
        )}
        {!filtered.length && (
          <p className="empty">
            {inventoryPage ? "No products match these filters." : search ? "No matching product" : "No inventory assigned yet"}
          </p>
        )}
      </div>
    </section>
  );
  function history(events: Event[]) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date / Reference</th>
              <th>Operation</th>
              {admin && <th>Location</th>}
              <th>Products / quantities</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>
                  {date(e.createdAt)}
                  <div className="small muted">{e.id}</div>
                </td>
                <td>
                  {e.type === "QUARANTINED" ? "On hold" : e.type === "DISPOSE_QUARANTINED" ? "Permanently remove held stock" : e.type.replaceAll("_", " ")}
                  {e.type === "RETURN" && (
                    <div className="small muted">{e.condition === "QUARANTINED" ? "On hold" : e.condition}</div>
                  )}
                </td>
                {admin && <td>{owner(e.ownerId)}</td>}
                <td>
                  {e.items.map((i) => (
                    <div key={i.id}>
                      {names(i.productId)}: <strong>{fmt(i.quantity)}</strong>
                      {["READY", "DISPATCH"].includes(e.type)
                        ? ` (${i.boxes} boxes × ${i.piecesPerBox} + ${i.loosePieces} pieces)`
                        : ""}
                      {["DISPATCH", "SALE"].includes(e.type) && (
                        <span className="small muted">
                          {" "}
                          · {fmt(i.processed)}{" "}
                          {e.type === "DISPATCH" ? "received" : "returned"}
                        </span>
                      )}
                    </div>
                  ))}
                </td>
                <td>{e.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && <p className="empty">No operations recorded yet</p>}
      </div>
    );
  }
  return (
    <div className="app quantity-app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Boxes size={24} />
          </span>
          HERBAL MAZA
        </div>
        <div className="brand-sub">
          {manufacturer ? "MANUFACTURING" : "INVENTORY"}
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {nav.map((n) => (
            <button
              key={n.name}
              className={safePage === n.name ? "selected" : ""}
              onClick={() => {
                setPage(n.name);
                location.hash = encodeURIComponent(n.name);
                setSearch("");
              }}
            >
              <n.icon size={18} />
              {n.name === "Operations" ? "Stock activity" : n.name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>
            {admin ? "Admin" : manufacturer ? "Manufacturer" : "Branch manager"}
          </strong>
          <p className="small muted quantity-email">{data.user.email}</p>
          <button
            className="secondary"
            onClick={() => void logout()}
            disabled={loggingOut}
          >
            <LogOut size={16} />
            {loggingOut ? "Logging out..." : "Log out"}
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            {manufacturer ? "Production" : "Inventory"} / {safePage === "Operations" ? "Stock activity" : safePage}
          </span>
          <div className="topbar-right">
            <button
              className="secondary"
              onClick={() => void logout()}
              disabled={loggingOut}
            >
              <LogOut size={16} />
              {loggingOut ? "Logging out..." : "Log out"}
            </button>
            <span className="small muted" role="status">
              {manufacturer ? "Production connected" : "Inventory connected"}
            </span>
            <button
              aria-label={
                manufacturer
                  ? "Refresh production workspace"
                  : "Refresh inventory"
              }
              className="icon-button"
              onClick={() => void load()}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-head">
            <div>
              <p className="eyebrow">{data.settings.name}</p>
              <h1>{safePage === "Operations" ? "Stock activity" : safePage}</h1>
              <p className="muted">
                {admin
                  ? "Manage your warehouse, branches and manufacturers."
                  : manufacturer
                    ? "Record finished products and dispatches for admin confirmation."
                    : "Inventory assigned to your branch and its history."}
              </p>
            </div>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {safePage === "Dashboard" && (
            <>
              <div className="quantity-cards">
                {[
                  [
                    admin
                      ? "Central quantity"
                      : manufacturer
                        ? "Ready pieces"
                        : "Assigned quantity",
                    fmt(data.products.reduce((n, p) => n + Number(p.stock), 0)),
                  ],
                  ["Products", String(data.products.length)],
                  ...(admin || manufacturer
                    ? [["In transit pieces", fmt(inTransit)]]
                    : []),
                  ["Recorded operations", String(data.events.length)],
                ].map(([label, value]) => (
                  <section className="panel" key={label}>
                    <p className="muted small">{label}</p>
                    <strong className="quantity-number">{value}</strong>
                  </section>
                ))}
              </div>
              <section className="panel">
                <h2>Quick operations</h2>
                <div className="actions quantity-actions">
                  {(admin
                    ? ["STOCK_IN", "SALE", "RETURN", "ASSIGN", "RECEIVE"]
                    : manufacturer
                      ? ["READY", "DISPATCH"]
                      : ["SALE", "RETURN", "LOSS"]
                  ).map((t) => (
                    <button key={t} onClick={() => setMode(t as Mode)}>
                      {titles[t as Mode]}
                    </button>
                  ))}
                </div>
              </section>
              <DashboardInsights
                data={{ ...data, products: dashboardProducts }}
              />
              {inventory}
              <section className="panel">
                <h2>Recent activity</h2>
                {history(data.events.slice(0, 10))}
              </section>
            </>
          )}
          {safePage === "Inventory" && (
            <>
              {admin && (
                <div className="actions quantity-actions">
                  <button onClick={() => setProduct("new")}>Enter new product details</button>
                  <button
                    className="secondary"
                    onClick={() => setBulk("import")}
                  >
                    Import new products from Excel
                  </button>
                  <button className="secondary" onClick={() => setBulk("scan")}>
                    <ScanLine size={16} />
                    Add new products by barcode
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setMode("STOCK_IN")}
                  >
                    Add stock to warehouse
                  </button>
                </div>
              )}
              {inventory}
            </>
          )}
          {safePage === "Branches" && admin && (
            <>
              <div className="actions quantity-actions">
                <button onClick={() => setMode("ASSIGN")}>
                  Send stock to branch
                </button>
                <button
                  className="secondary"
                  onClick={() => setMode("BRANCH_RETURN")}
                >
                  Return branch stock to warehouse
                </button>
                <button
                  className="secondary"
                  onClick={() => setPage("Settings")}
                >
                  Manage accounts
                </button>
              </div>
              <section className="panel">
                <h2>Branch inventory</h2>
                {data.users
                  .filter((u) => u.role === "BRANCH_MANAGER")
                  .map((u) => (
                    <div className="activity-row" key={u.id}>
                      <div>
                        <strong>{u.email}</strong>
                        {!u.active && " (disabled)"}
                        {data.balances
                          .filter((b) => b.ownerId === u.id)
                          .map((b) => (
                            <p key={b.productId}>
                              {names(b.productId)}: {fmt(b.quantity)}
                            </p>
                          ))}
                      </div>
                    </div>
                  ))}
              </section>
            </>
          )}
          {safePage === "Production" && (
            <>
              <div className="actions quantity-actions">
                {manufacturer ? (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setManufacturerProduct(true)}
                    >
                      Enter new product details
                    </button>
                    <button onClick={() => setMode("READY")}>
                      Record finished stock
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setMode("DISPATCH")}
                    >
                      Send stock to warehouse
                    </button>
                  </>
                ) : (
                  <button onClick={() => setMode("RECEIVE")}>
                    Receive stock from manufacturer
                  </button>
                )}
              </div>
              <section className="panel">
                <h2>
                  {manufacturer
                    ? "Production entries"
                    : "Manufacturing inventory and transit"}
                </h2>
                {manufacturer ? (
                  <p className="small muted">
                    Record finished products and dispatch quantities here. Admin
                    confirms each dispatch; inventory balances and submission
                    history are not shown.
                  </p>
                ) : (
                  <>
                    {data.users
                      .filter((u) => u.role === "MANUFACTURER")
                      .map((u) => (
                        <p key={u.id}>
                          <strong>{u.email}</strong> —{" "}
                          {data.balances
                            .filter((b) => b.ownerId === u.id)
                            .map(
                              (b) =>
                                `${names(b.productId)}: ${fmt(b.quantity)} ready`,
                            )
                            .join(", ") || "No ready stock"}
                        </p>
                      ))}
                    {history(
                      data.events.filter((e) =>
                        ["READY", "DISPATCH", "RECEIVE"].includes(e.type),
                      ),
                    )}
                  </>
                )}
              </section>
            </>
          )}
          {safePage === "Operations" && (
            <>
              {branch && (
                <div className="actions quantity-actions">
                  {(
                    [
                      "SALE",
                      "RETURN",
                      "LOSS",
                      "DAMAGED",
                      "EXPIRED",
                      "QUARANTINED",
                    ] as Mode[]
                  ).map((t) => (
                    <button key={t} onClick={() => setMode(t)}>
                      {titles[t]}
                    </button>
                  ))}
                </div>
              )}
              <div className="actions quantity-actions">
                {admin &&
                  (
                    [
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
                      "LEGACY_RETURN",
                    ] as Mode[]
                  ).map((t) => (
                    <button
                      className="secondary"
                      key={t}
                      onClick={() => setMode(t)}
                    >
                      {titles[t]}
                    </button>
                  ))}
              </div>
              <section className="panel">
                <div className="section-head">
                  <h2>Stock operations</h2>
                  <a className="export-link" href="/api/export?type=operations">
                    Download stock activity Excel
                  </a>
                </div>
                {history(data.events)}
              </section>
              {admin && (
                <section className="panel">
                  <h2>Earlier sales and returns</h2>
                  {data.legacySales.map((s) => (
                    <p key={s.id}>
                      {s.number} · {s.status} ·{" "}
                      {s.items
                        .map(
                          (i) =>
                            `${names(i.productId)}: ${fmt(i.quantity)} sold / ${fmt(i.returned)} returned`,
                        )
                        .join(", ")}
                    </p>
                  ))}
                  {data.legacyReturns.map((r) => (
                    <p key={r.id}>
                      {r.number} · {r.reason} ·{" "}
                      {r.items
                        .map(
                          (i) =>
                            `${names(i.productId)}: ${fmt(i.quantity)} ${i.condition === "QUARANTINED" ? "On hold" : i.condition}`,
                        )
                        .join(", ")}
                    </p>
                  ))}
                </section>
              )}
            </>
          )}
          {safePage === "Purchases" && admin && (
            <>
              <div className="actions quantity-actions">
                <button onClick={() => setMode("PURCHASE")}>
                  Create purchase order
                </button>
                <button
                  className="secondary"
                  onClick={() => setMode("PO_RECEIVE")}
                >
                  Receive stock from supplier
                </button>
              </div>
              <section className="panel">
                <h2>Purchase orders</h2>
                {data.purchases.map((p) => (
                  <div className="activity-row" key={p.id}>
                    <div>
                      <strong>{p.number}</strong> ·{" "}
                      {data.suppliers.find((s) => s.id === p.supplierId)?.name}{" "}
                      · {p.status}
                      <p>
                        {p.items
                          .map(
                            (i) =>
                              `${names(i.productId)}: ${fmt(i.received)} / ${fmt(i.quantity)} received`,
                          )
                          .join(", ")}
                      </p>
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}
          {safePage === "Suppliers" && admin && (
            <section className="panel">
              <div className="section-head">
                <h2>Suppliers</h2>
                <button onClick={() => setSupplier(true)}>Enter new supplier details</button>
              </div>
              {data.suppliers.map((s) => (
                <p key={s.id}>
                  {s.name} · {s.phone} · {s.email}
                </p>
              ))}
            </section>
          )}
          {safePage === "Reports" && (
            <>
              {inventory}
              <section className="panel">
                <div className="section-head">
                  <h2>Quantity history</h2>
                  <a className="export-link" href="/api/export?type=operations">
                    Download stock activity Excel
                  </a>
                </div>
                {history(data.events)}
              </section>
            </>
          )}
          {safePage === "Settings" && (
            <>
              {admin && (
                <section className="panel">
                  <h2>Inventory preferences</h2>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        const f = new FormData(e.currentTarget);
                        await post("/api/data", {
                          action: "settings",
                          data: {
                            name: f.get("name"),
                            minStock: f.get("minStock"),
                            dateFormat: "dd/MM/yyyy",
                          },
                        });
                        await load();
                        toast.success("Settings saved");
                      } catch (e) {
                        toast.error(String(e));
                      }
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        Business name
                        <input
                          name="name"
                          required
                          defaultValue={data.settings.name}
                        />
                      </label>
                      <label>
                        Default minimum stock
                        <input
                          name="minStock"
                          type="number"
                          min="0"
                          step="0.001"
                          required
                          defaultValue={String(data.settings.minStock)}
                        />
                      </label>
                    </div>
                    <button>Save preferences</button>
                  </form>
                </section>
              )}
              <Accounts admin={admin} />
            </>
          )}
        </div>
      </main>
      {camera && (
        <Scanner
          actionLabel="Find product by barcode"
          onScan={(code) => {
            if (inventoryPage) changeFilters({ search: code });
            else setSearch(code);
            setCamera(false);
          }}
          onClose={() => setCamera(false)}
        />
      )}
      {bulk && (
        <BulkProducts
          mode={bulk}
          data={data}
          onClose={() => setBulk(null)}
          onSaved={load}
        />
      )}
      {mode && (
        <BatchForm
          data={data}
          mode={mode}
          close={() => setMode(null)}
          saved={load}
        />
      )}
      {product && (
        <ProductForm
          product={product}
          close={() => setProduct(null)}
          saved={load}
        />
      )}
      {manufacturerProduct && (
        <ManufacturerProductForm
          close={() => setManufacturerProduct(false)}
          saved={load}
        />
      )}
      {supplier && (
        <Modal title="Enter new supplier details" close={() => setSupplier(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await post("/api/data", {
                  action: "supplier",
                  data: Object.fromEntries(new FormData(e.currentTarget)),
                });
                await load();
                setSupplier(false);
              } catch (e) {
                toast.error(String(e));
              }
            }}
          >
            <div className="form-grid">
              {["name", "contact", "phone", "email", "address"].map((k) => (
                <label key={k}>
                  {k}
                  <input name={k} required={k === "name"} />
                </label>
              ))}
            </div>
            <button>Create supplier</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ManufacturerProductForm({
  close,
  saved,
}: {
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Enter new product details"
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="small muted">
        New products are added as active items measured in pieces (pcs). Admin
        can complete other catalog details later.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const values = Object.fromEntries(new FormData(e.currentTarget));
            await post("/api/manufacturing/products", values);
            await saved();
            toast.success(
              "Product added. Record ready products to submit its quantity.",
            );
            close();
          } catch (e) {
            const message =
              e instanceof Error ? e.message : "Unable to add product";
            setError(message);
            toast.error(message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Product name
            <input name="name" required maxLength={191} autoFocus />
          </label>
          <label>
            SKU (optional)
            <input name="sku" maxLength={191} />
          </label>
          <label>
            Barcode (optional)
            <input name="barcode" maxLength={191} />
          </label>
          <label>
            Category (optional)
            <input name="category" maxLength={191} />
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy}>
          {busy ? "Adding product…" : "Create product"}
        </button>
      </form>
    </Modal>
  );
}

function ProductForm({
  product,
  close,
  saved,
}: {
  product: Product | "new";
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false);
  const [barcode, setBarcode] = useState(
    product === "new" ? "" : product.barcode || "",
  );
  const p = product === "new" ? null : product;
  return (
    <Modal
      title={p ? "Edit product" : "Enter new product details"}
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const fd = new FormData(e.currentTarget);
            await post("/api/data", {
              action: "product",
              id: p?.id,
              data: {
                ...Object.fromEntries(fd),
                barcode,
                active: fd.get("active") === "on",
              },
            });
            await saved();
            close();
            toast.success("Product saved");
          } catch (e) {
            toast.error(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {[
            "name",
            "sku",
            "category",
            "unit",
            "minStock",
            "expiryDate",
            "notes",
          ].map((k) => (
            <label key={k}>
              {
                {
                  name: "Product name",
                  sku: "SKU",
                  category: "Category",
                  unit: "Unit (pcs for manufacturing)",
                  minStock: "Minimum stock",
                  expiryDate: "Expiry date",
                  notes: "Notes",
                }[k]
              }
              <input
                name={k}
                type={k === "expiryDate" ? "date" : "text"}
                required={k === "name" || k === "unit"}
                defaultValue={String(
                  (k === "expiryDate"
                    ? p?.expiryDate?.slice(0, 10)
                    : p?.[k as keyof Product]) ??
                    (k === "unit" ? "pcs" : k === "minStock" ? "5" : ""),
                )}
              />
            </label>
          ))}
          <label>
            Barcode
            <input
              aria-label="Product barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => setCamera(true)}
          >
            Fill barcode using camera
          </button>
          <label className="check-label">
            <input
              name="active"
              type="checkbox"
              defaultChecked={p?.active ?? true}
            />
            Active product
          </label>
        </div>
        <button disabled={busy}>{busy ? "Saving…" : p ? "Save product changes" : "Create product"}</button>
      </form>
      {camera && (
        <Scanner
          actionLabel="Use entered barcode"
          onScan={(code) => {
            setBarcode(code);
            setCamera(false);
          }}
          onClose={() => setCamera(false)}
        />
      )}
    </Modal>
  );
}

type Row = {
  productId: string;
  quantity: string;
  boxes: string;
  piecesPerBox: string;
  loosePieces: string;
};
function BatchForm({
  data,
  mode,
  close,
  saved,
}: {
  data: Data;
  mode: Mode;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const packing = mode === "READY" || mode === "DISPATCH";
  const manufacturer = data.user.role === "MANUFACTURER";
  const [rows, stateRows] = useState<Row[]>([]),
    queue = useRef<Row[]>([]);
  const setRows = (next: Row[]) => {
    queue.current = next;
    stateRows(next);
  };
  const [ownerId, setOwner] = useState(
    packing || data.user.role === "BRANCH_MANAGER"
      ? data.user.id
      : ["ASSIGN", "BRANCH_RETURN"].includes(mode)
        ? ""
        : "CENTRAL",
  );
  const [sourceId, setSource] = useState(""),
    [supplierId, setSupplier] = useState(""),
    [barcode, setBarcode] = useState("");
  const [camera, setCamera] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const [condition, setCondition] = useState("SELLABLE");
  const input = useRef<HTMLInputElement>(null);
  const branches = data.users.filter(
    (u) => u.role === "BRANCH_MANAGER" && u.active,
  );
  const source = data.events.find((e) => e.id === sourceId),
    po = data.purchases.find((e) => e.id === sourceId),
    oldSale = data.legacySales.find((e) => e.id === sourceId);
  const sourceRequired = [
    "RETURN",
    "RECEIVE",
    "PO_RECEIVE",
    "LEGACY_RETURN",
  ].includes(mode);
  const available = data.products.filter((p) =>
    sourceRequired
      ? mode === "PO_RECEIVE"
        ? po?.items.some(
            (i) =>
              i.productId === p.id && Number(i.quantity) > Number(i.received),
          )
        : mode === "LEGACY_RETURN"
          ? oldSale?.items.some(
              (i) =>
                i.productId === p.id && Number(i.quantity) > Number(i.returned),
            )
          : source?.items.some(
              (i) =>
                i.productId === p.id &&
                Number(i.quantity) > Number(i.processed),
            )
      : p.active,
  );
  const sourceEvents = data.events.filter(
    (e) =>
      e.type === (mode === "RECEIVE" ? "DISPATCH" : "SALE") &&
      (mode === "RECEIVE" || e.ownerId === ownerId) &&
      e.items.some((i) => Number(i.quantity) > Number(i.processed)),
  );
  const sourceLabel = (event: Event) => {
    const pending = event.items
      .filter((item) => Number(item.quantity) > Number(item.processed))
      .map(
        (item) =>
          `${data.products.find((p) => p.id === item.productId)?.name || item.productId}: ${fmt(
            Number(item.quantity) - Number(item.processed),
          )} pcs`,
      )
      .join(", ");
    const manufacturerName =
      data.users.find((u) => u.id === event.ownerId)?.email || "Manufacturer";
    return `${date(event.createdAt)} · ${manufacturerName} · ${pending}`;
  };
  const add = (id: string) => {
    setError("");
    setConfirmed(false);
    const current = queue.current;
    if (!available.some((p) => p.id === id)) {
      setError("Product is unavailable in the selected source");
      return;
    }
    const found = current.find((r) => r.productId === id);
    if (found) {
      try {
        setRows(
          current.map((r) =>
            r === found
              ? {
                  ...r,
                  quantity: D(r.quantity || "0")
                    .plus(1)
                    .toString(),
                  loosePieces: String(
                    Number(r.loosePieces || 0) + (packing ? 1 : 0),
                  ),
                }
              : r,
          ),
        );
      } catch {
        setError("Fix the current quantity before scanning again");
      }
    } else if (current.length < 100)
      setRows([
        ...current,
        {
          productId: id,
          quantity: "1",
          boxes: "0",
          piecesPerBox: "1",
          loosePieces: packing ? "1" : "0",
        },
      ]);
    else setError("Save this batch before adding more products (100 maximum)");
  };
  const scan = (code: string) => {
    setBarcode("");
    input.current?.focus();
    const p = available.find((p) =>
      [p.barcode, p.sku].some(
        (v) => v?.toLowerCase() === code.trim().toLowerCase(),
      ),
    );
    if (p) add(p.id);
    else
      setError(
        "Barcode not found. Register the product first or choose the correct source.",
      );
  };
  const edit = (index: number, field: keyof Row, value: string) => {
    setConfirmed(false);
    setRows(
      queue.current.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, [field]: value };
        if (packing)
          next.quantity = String(
            Number(next.boxes || 0) * Number(next.piecesPerBox || 1) +
              Number(next.loosePieces || 0),
          );
        return next;
      }),
    );
  };
  const notes = `Automatic entry: ${titles[mode]}`;
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const items = rows.map((r) => ({
        ...r,
        boxes: Number(r.boxes),
        piecesPerBox: Number(r.piecesPerBox),
        loosePieces: Number(r.loosePieces),
      }));
      if (mode === "PURCHASE")
        await post("/api/data", {
          action: "purchase",
          requestKey: key,
          supplierId,
          notes,
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitCost: "0",
          })),
        });
      else if (mode === "PO_RECEIVE")
        await post("/api/data", {
          action: "receipt",
          requestKey: key,
          orderId: sourceId,
          items: items.map((i) => ({
            orderItemId: po!.items.find((s) => s.productId === i.productId)!.id,
            quantity: i.quantity,
          })),
        });
      else if (mode === "LEGACY_RETURN")
        await post("/api/data", {
          action: "return",
          requestKey: key,
          reason: notes,
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            saleItemId: oldSale!.items.find((s) => s.productId === i.productId)!
              .id,
            condition,
          })),
        });
      else
        await post("/api/quantity", {
          type: mode,
          requestKey: key,
          ownerId,
          sourceId: sourceId || undefined,
          condition,
          notes,
          items,
        });
      await saved();
      close();
      toast.success("Stock operation saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={titles[mode]}
      close={() => {
        if (!busy) close();
      }}
    >
      {addingProduct && (
        <section className="panel" aria-label="Enter new product details">
          <p className="small muted">
            Add the product here and it will be included in this ready batch.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (queue.current.length >= 100) {
                setError(
                  "Save this batch before adding more products (100 maximum)",
                );
                return;
              }
              setBusy(true);
              setError("");
              try {
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                const result = await post(
                  "/api/manufacturing/products",
                  values,
                );
                if (!result || typeof result.id !== "string")
                  throw new Error(
                    "Product was added but could not be selected",
                  );
                await saved();
                setRows([
                  ...queue.current,
                  {
                    productId: result.id,
                    quantity: "1",
                    boxes: "0",
                    piecesPerBox: "1",
                    loosePieces: "1",
                  },
                ]);
                setConfirmed(false);
                setAddingProduct(false);
                toast.success("Product added to this ready batch");
              } catch (e) {
                const message =
                  e instanceof Error ? e.message : "Unable to add product";
                setError(message);
                toast.error(message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Product name
                <input name="name" required maxLength={191} autoFocus />
              </label>
              <label>
                SKU (optional)
                <input name="sku" maxLength={191} />
              </label>
              <label>
                Barcode (optional)
                <input name="barcode" maxLength={191} />
              </label>
              <label>
                Category (optional)
                <input name="category" maxLength={191} />
              </label>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button disabled={busy}>
                {busy ? "Adding product…" : "Create product and add to list"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setAddingProduct(false);
                  setError("");
                }}
              >
                Cancel new product entry
              </button>
            </div>
          </form>
        </section>
      )}
      <p className="muted small">
        Add multiple products or scan barcodes. Repeat scans add one piece.
        Review the complete batch before saving.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setConfirmed(true);
        }}
      >
        {manufacturer && mode === "READY" && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setError("");
              setAddingProduct(true);
            }}
          >
            Enter new product details
          </button>
        )}
        <div className="form-grid">
          {["RETURN", "LEGACY_RETURN"].includes(mode) && (
            <label>
              Return condition
              <select
                value={condition}
                onChange={(e) => {
                  setCondition(e.target.value);
                  setConfirmed(false);
                }}
              >
                {["SELLABLE", "DAMAGED", "EXPIRED", "QUARANTINED"].map((c) => (
                  <option key={c} value={c}>
                    {{ SELLABLE: "Available for sale", DAMAGED: "Damaged", EXPIRED: "Expired", QUARANTINED: "On hold" }[c]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data.user.role === "ADMIN" &&
            [
              "ASSIGN",
              "BRANCH_RETURN",
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
            ].includes(mode) && (
              <label>
                Inventory location
                <select
                  required
                  value={ownerId}
                  onChange={(e) => {
                    setOwner(e.target.value);
                    setSource("");
                    setRows([]);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Choose branch</option>
                  {!["ASSIGN", "BRANCH_RETURN"].includes(mode) && (
                    <option value="CENTRAL">Central warehouse</option>
                  )}
                  {branches.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
          {mode === "PURCHASE" && (
            <label>
              Supplier
              <select
                required
                value={supplierId}
                onChange={(e) => {
                  setSupplier(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Choose supplier</option>
                {data.suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {sourceRequired && (
            <label>
              {mode === "RECEIVE"
                ? "Original dispatch"
                : mode === "PO_RECEIVE"
                  ? "Purchase order"
                  : "Original sale"}
              <select
                required
                value={sourceId}
                onChange={(e) => {
                  setSource(e.target.value);
                  setRows([]);
                  setConfirmed(false);
                }}
              >
                <option value="">{mode === "RECEIVE" ? "Choose manufacturer delivery" : mode === "PO_RECEIVE" ? "Choose purchase order" : "Choose original sale"}</option>
                {mode === "PO_RECEIVE"
                  ? data.purchases
                      .filter((p) =>
                        ["ORDERED", "PARTIALLY_RECEIVED"].includes(p.status),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number}
                        </option>
                      ))
                  : mode === "LEGACY_RETURN"
                    ? data.legacySales
                        .filter((s) => s.status === "COMPLETED")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.number}
                          </option>
                        ))
                    : sourceEvents.map((e) => (
                        <option key={e.id} value={e.id}>
                          {mode === "RECEIVE"
                            ? sourceLabel(e)
                            : `${date(e.createdAt)} · ${e.id}`}
                        </option>
                      ))}
                {mode === "RECEIVE" && sourceEvents.length === 0 && (
                  <option value="" disabled>
                    No manufacturer deliveries to receive
                  </option>
                )}
              </select>
            </label>
          )}
        </div>
        <div className="filters quantity-search">
          <input
            ref={input}
            aria-label="Scan operation barcode"
            placeholder="Scan barcode then Enter"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                scan(barcode);
              }
            }}
          />
          <button
            className="secondary"
            type="button"
            onClick={() => scan(barcode)}
          >
            Add item by barcode
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => setCamera(true)}
          >
            <ScanLine size={16} />
            Scan items with camera
          </button>
          <select
            aria-label="Add product to batch"
            value=""
            onChange={(e) => add(e.target.value)}
          >
            <option value="">Select product to add</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.barcode ? `(${p.barcode})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                {packing && (
                  <>
                    <th>Boxes</th>
                    <th>Pieces / box</th>
                    <th>Loose pieces</th>
                  </>
                )}
                <th>{packing ? "Total pieces" : "Quantity"}</th>
                {!manufacturer && <th>Available / remaining</th>}
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, index) => {
                const p = data.products.find((p) => p.id === r.productId)!;
                const original = source?.items.find(
                    (i) => i.productId === p.id,
                  ),
                  poi = po?.items.find((i) => i.productId === p.id),
                  old = oldSale?.items.find((i) => i.productId === p.id);
                const stockBucket:
                  "stock" | "damaged" | "expired" | "quarantined" =
                  mode === "RELEASE"
                    ? "quarantined"
                    : mode.startsWith("DISPOSE_")
                      ? (mode.slice(8).toLowerCase() as
                          "damaged" | "expired" | "quarantined")
                      : "stock";
                const remaining = original
                  ? Number(original.quantity) - Number(original.processed)
                  : poi
                    ? Number(poi.quantity) - Number(poi.received)
                    : old
                      ? Number(old.quantity) - Number(old.returned)
                      : ownerId === "CENTRAL"
                        ? p[stockBucket]
                        : data.balances.find(
                            (b) =>
                              b.ownerId === ownerId && b.productId === p.id,
                          )?.[
                            stockBucket === "stock" ? "quantity" : stockBucket
                          ] || "0";
                return (
                  <tr key={r.productId}>
                    <td>
                      {p.name}
                      <div className="small muted">{p.barcode}</div>
                    </td>
                    {packing &&
                      (["boxes", "piecesPerBox", "loosePieces"] as const).map(
                        (k) => (
                          <td key={k}>
                            <input
                              aria-label={`${k} row ${index + 1}`}
                              type="number"
                              min={k === "piecesPerBox" ? 1 : 0}
                              max="999999"
                              step="1"
                              required
                              value={r[k]}
                              onChange={(e) => edit(index, k, e.target.value)}
                            />
                          </td>
                        ),
                      )}
                    <td>
                      {packing ? (
                        fmt(r.quantity)
                      ) : (
                        <input
                          aria-label={`Quantity row ${index + 1}`}
                          type="number"
                          min="0.001"
                          max="999999999"
                          step="0.001"
                          required
                          value={r.quantity}
                          onChange={(e) =>
                            edit(index, "quantity", e.target.value)
                          }
                        />
                      )}
                    </td>
                    {!manufacturer && (
                      <td>
                        {fmt(remaining)} {p.unit}
                      </td>
                    )}
                    <td>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remove item ${index + 1} from list`}
                        onClick={() => {
                          setRows(queue.current.filter((_, i) => i !== index));
                          setConfirmed(false);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="empty">Scan or select products to start your batch.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {confirmed ? (
          <div className="quantity-review">
            <p>
              <strong>
                Review: {rows.length} products ·{" "}
                {fmt(rows.reduce((n, r) => n + Number(r.quantity), 0))} total
                units.
              </strong>
            </p>
            <button type="button" disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : confirmLabels[mode]}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setConfirmed(false)}
            >
              Keep editing
            </button>
          </div>
        ) : (
          <button disabled={!rows.length || busy}>Review entries</button>
        )}
      </form>
      {camera && (
        <Scanner actionLabel="Add item by barcode" continuous onScan={scan} onClose={() => setCamera(false)} />
      )}
    </Modal>
  );
}
