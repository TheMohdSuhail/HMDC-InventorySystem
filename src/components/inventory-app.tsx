"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import { useForm } from "react-hook-form";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ClipboardPlus,
  FileDown,
  Leaf,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sun,
  Trash2,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { D } from "@/lib/math";
import type {
  Data,
  ProductData,
  PurchaseData,
  SaleData,
  ReportData,
} from "@/lib/types";
import dynamic from "next/dynamic";
const Scanner = dynamic(() => import("./scanner"), { ssr: false });
const BulkProducts = dynamic(() => import("./bulk-products"), { ssr: false });
import Accounts from "./accounts";
type Page =
  | "Dashboard"
  | "Products"
  | "Sales"
  | "Returns"
  | "Stock Adjustments"
  | "Purchases"
  | "Suppliers"
  | "Reports"
  | "Settings";
type Modal = { kind: string; id?: string; barcode?: string };
const nav = [
  ["Dashboard", LayoutDashboard],
  ["Products", Package],
  ["Sales", ShoppingBag],
  ["Returns", RotateCcw],
  ["Stock Adjustments", ClipboardList],
  ["Purchases", Truck],
  ["Suppliers", Users],
  ["Reports", BarChart3],
  ["Settings", Settings],
] as const;
const today = () =>
  new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const money = (n: string | number | { toString(): string }) =>
  "₹" +
  D(n).toNumber().toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const qty = (n: string | number) =>
  D(n).toNumber().toLocaleString("en-IN", { maximumFractionDigits: 3 });
const date = (s: string, format = "dd/MM/yyyy") =>
  format === "yyyy-MM-dd"
    ? new Date(new Date(s).getTime() + 330 * 60000).toISOString().slice(0, 10)
    : new Date(s).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
const sum = <T,>(rows: T[], fn: (x: T) => string) =>
  rows.reduce((v, x) => v.plus(fn(x)), D(0));
function Tag({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={"tag " + (tone || "")}>{children}</span>;
}
function Empty({
  title = "Nothing here yet",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Boxes size={30} />
      <h3>{title}</h3>
      <p>{children || "Records will appear here as you use your inventory."}</p>
    </div>
  );
}
function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function ProductName({ product }: { product: ProductData }) {
  return (
    <div className="product-cell">
      <span className="product-mark">
        <Leaf size={17} />
      </span>
      <div>
        <strong>{product.name}</strong>
        <div className="muted small">
          {product.sku || product.category || product.unit}
        </div>
      </div>
    </div>
  );
}
function Field({
  label,
  name,
  type = "text",
  value,
  required = false,
  min,
  step,
  placeholder,
  readOnly = false,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string;
  required?: boolean;
  min?: string;
  step?: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        min={min}
        step={step}
        placeholder={placeholder}
        readOnly={readOnly}
      />
    </label>
  );
}
function Notes({
  value,
  name = "notes",
  label = "Notes (optional)",
}: {
  value?: string | null;
  name?: string;
  label?: string;
}) {
  if (name === "reason") return null;
  return (
    <label>
      {label}
      <textarea name={name} defaultValue={value || ""} maxLength={2000} />
    </label>
  );
}
function StockSelect({
  products,
  name = "productId",
  defaultValue,
  onChange,
}: {
  products: ProductData[];
  name?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
}) {
  return (
    <label>
      Product
      <select
        name={name}
        aria-label="Product"
        required={name !== "lookup"}
        defaultValue={defaultValue || ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="" disabled>
          Select a product
        </option>
        {products
          .filter((p) => p.active || p.id === defaultValue)
          .map((p) => (
            <option value={p.id} key={p.id}>
              {p.name} · {qty(p.stock)} {p.unit} available
            </option>
          ))}
      </select>
    </label>
  );
}
function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
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
      aria-label={title}
      className={"dialog native-dialog " + (wide ? "wide" : "")}
      onCancel={onClose}
    >
      <div className="section-head">
        <h2>{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="icon-button"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function InventoryApp() {
  const [page, setPage] = useState<Page>("Dashboard");
  const [data, setData] = useState<Data | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [reportError, setReportError] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState("active");
  const [sort, setSort] = useState("name");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [preset, setPreset] = useState("Today");
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [scan, setScan] = useState(false);
  const [bulkMode, setBulkMode] = useState<"import" | "scan" | null>(null);
  const [offset, setOffset] = useState(0);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/data", { cache: "no-store" });
      if (r.status === 401) {
        location.assign("/login");
        return;
      }
      const json = await r.json();
      if (!r.ok) throw new Error(json.error);
      setData(json);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load inventory");
    }
  }, []);
  const loadReports = useCallback(async () => {
    setReportError("");
    setReport(null);
    try {
      const r = await fetch(`/api/reports?from=${from}&to=${to}`, {
        cache: "no-store",
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error);
      setReport(json);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Unable to load report");
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (data) void loadReports();
  }, [data, loadReports]);
  useEffect(() => {
    const v = localStorage.getItem("inventory-theme") === "dark";
    setDark(v);
    const barcode = new URLSearchParams(location.search).get("barcode");
    if (barcode) setModal({ kind: "product", barcode });
    const hash = decodeURIComponent(location.hash.slice(1));
    if (nav.some(([n]) => n === hash)) setPage(hash as Page);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", dark);
    localStorage.setItem("inventory-theme", dark ? "dark" : "light");
  }, [dark]);
  const go = (p: Page) => {
    setPage(p);
    setQuery("");
    setOffset(0);
    setOpen(false);
    location.hash = p;
  };
  const onScan = useCallback(
    (code: string) => {
      setScan(false);
      setPage("Products");
      setQuery(code);
      const p = data?.products.find((x) => x.barcode === code);
      if (p) {
        setModal({ kind: "productDetail", id: p.id });
        toast.success("Product found");
      } else {
        toast.error(
          data?.user.role === "ADMIN"
            ? "Barcode is not registered"
            : "Unknown barcode. Ask an admin to add this product.",
        );
        if (data?.user.role === "ADMIN")
          setModal({ kind: "product", barcode: code });
      }
    },
    [data],
  );
  function choosePreset(value: string) {
    setPreset(value);
    const t = new Date(today() + "T00:00:00Z");
    let start = new Date(t),
      end = new Date(t);
    if (value === "Yesterday") {
      start = new Date(+t - 86400000);
      end = start;
    }
    if (value === "Last 7 days") start = new Date(+t - 6 * 86400000);
    if (value === "Last 30 days") start = new Date(+t - 29 * 86400000);
    if (value === "This month")
      start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
    if (value === "Previous month") {
      start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
      end = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
    }
    if (value !== "Custom") {
      setFrom(start.toISOString().slice(0, 10));
      setTo(end.toISOString().slice(0, 10));
    }
    setOffset(0);
  }
  const matches = (s: string) => s.toLowerCase().includes(query.toLowerCase());
  const inRange = (s: string) => {
    const d = new Date(new Date(s).getTime() + 330 * 60000)
      .toISOString()
      .slice(0, 10);
    return d >= from && d <= to;
  };
  const paginate = <T,>(items: T[]) => items.slice(offset, offset + 20);
  const pager = (length: number) => (
    <div className="pagination">
      <span className="muted small">
        {length === 0 ? "0" : offset + 1}–{Math.min(offset + 20, length)} of{" "}
        {length}
      </span>
      <button
        className="icon-button"
        disabled={!offset}
        onClick={() => setOffset(Math.max(0, offset - 20))}
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        className="icon-button"
        disabled={offset + 20 >= length}
        onClick={() => setOffset(offset + 20)}
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
  const products = (data?.products || [])
    .filter(
      (p) =>
        matches([p.name, p.sku, p.barcode, p.category].join(" ")) &&
        (stockFilter === "all" ||
          (stockFilter === "active" && p.active) ||
          (stockFilter === "archived" && !p.active) ||
          (stockFilter === "low" && p.active && D(p.stock).lte(p.minStock))),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "stock"
          ? D(a.stock).cmp(b.stock)
          : D(b.sellingPrice).cmp(a.sellingPrice),
    );
  const sales = (data?.sales || []).filter(
    (s) => matches([s.number, s.customer].join(" ")) && inRange(s.createdAt),
  );
  const purchases = (data?.purchases || []).filter(
    (p) =>
      matches([p.number, p.supplier.name, p.status].join(" ")) &&
      inRange(p.createdAt),
  );
  const returns = (data?.returns || []).filter(
    (r) =>
      matches(
        [r.number, r.reason, ...r.items.map((x) => x.product.name)].join(" "),
      ) && inRange(r.createdAt),
  );
  const movements = (data?.movements || []).filter(
    (m) =>
      matches([m.product.name, m.type, m.reason].join(" ")) &&
      inRange(m.createdAt),
  );
  const suppliers = (data?.suppliers || []).filter((s) =>
    matches([s.name, s.contact, s.phone, s.email].join(" ")),
  );
  const low =
    data?.products.filter((p) => p.active && D(p.stock).lte(p.minStock)) || [];
  const periodLabel =
    from === to
      ? date(from + "T00:00:00+05:30")
      : date(from + "T00:00:00+05:30") + " – " + date(to + "T00:00:00+05:30");
  const dateFilters = (
    <div className="filters">
      <CalendarDays size={16} className="muted" />
      <select
        aria-label="Date preset"
        value={preset}
        onChange={(e) => choosePreset(e.target.value)}
      >
        {[
          "Today",
          "Yesterday",
          "Last 7 days",
          "Last 30 days",
          "This month",
          "Previous month",
          "Custom",
        ].map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor="from">
        From date
      </label>
      <input
        id="from"
        type="date"
        value={from}
        onChange={(e) => {
          setFrom(e.target.value);
          setPreset("Custom");
          setOffset(0);
        }}
        style={{ width: 146 }}
      />
      <span className="muted">–</span>
      <label className="sr-only" htmlFor="to">
        To date
      </label>
      <input
        id="to"
        type="date"
        value={to}
        onChange={(e) => {
          setTo(e.target.value);
          setPreset("Custom");
          setOffset(0);
        }}
        style={{ width: 146 }}
      />
      <span className="date-note">Asia/Kolkata · INR</span>
    </div>
  );
  const search = (
    <div className="filters">
      <Search size={17} className="muted" />
      <input
        aria-label={`Search ${page}`}
        type="search"
        placeholder={`Search ${page.toLowerCase()}…`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOffset(0);
        }}
        style={{ maxWidth: 360 }}
      />
      {page === "Products" && (
        <>
          <select
            aria-label="Product filter"
            value={stockFilter}
            onChange={(e) => {
              setStockFilter(e.target.value);
              setOffset(0);
            }}
            style={{ width: 150 }}
          >
            <option value="active">Active products</option>
            <option value="all">All products</option>
            <option value="low">Low stock</option>
            <option value="archived">Archived</option>
          </select>
          <select
            aria-label="Sort products"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{ width: 150 }}
          >
            <option value="name">Name A–Z</option>
            <option value="stock">Stock: low first</option>
            <option value="price">Price: high first</option>
          </select>
        </>
      )}
    </div>
  );
  const admin = data?.user.role === "ADMIN";
  const actions: Partial<Record<Page, { label: string; kind: string }>> = {
    Products: { label: "Add product", kind: "product" },
    Sales: { label: "New sale", kind: "sale" },
    Returns: { label: "Record return", kind: "return" },
    "Stock Adjustments": { label: "Adjust stock", kind: "adjustment" },
    Purchases: { label: "New purchase", kind: "purchase" },
    Suppliers: { label: "Add supplier", kind: "supplier" },
  };
  const descriptions: Record<Page, string> = {
    Dashboard: "A clear view of your inventory and business, at a glance.",
    Products: "Your product catalog, stock levels, and pricing.",
    Sales: "Every order, with a complete stock and cost history.",
    Returns: "Record refunds and keep returned stock in the right condition.",
    "Stock Adjustments": "Keep a record of every change, loss, and correction.",
    Purchases: "From supplier order to the stock on your shelf.",
    Suppliers: "The people behind your products.",
    Reports: "Understand your sales, stock, and estimated profit.",
    Settings: "Make this workspace your own.",
  };
  return (
    <div className="app">
      <aside className={"sidebar " + (open ? "open" : "")}>
        <div className="brand">
          <span className="brand-icon">
            <Leaf size={21} />
          </span>
          HERBAL MAZA
        </div>
        <div className="brand-sub">INVENTORY MANAGER</div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(([n, Icon]) => (
            <button
              key={n}
              onClick={() => go(n)}
              className={page === n ? "selected" : ""}
            >
              <Icon size={18} />
              {n}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="product-cell">
            <span className="avatar">
              <Leaf size={17} />
            </span>
            <div>
              <strong className="small">
                {data?.settings.name || "Inventory workspace"}
              </strong>
              <div className="small muted">
                {admin ? "Admin" : "User"} access · INR
              </div>
            </div>
          </div>
          <p className="small muted" style={{ margin: "18px 10px 0" }}>
            A little more organized, every day.
          </p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="actions">
            <button
              className="icon-button mobile-menu"
              onClick={() => setOpen(!open)}
              aria-label="Toggle navigation"
            >
              <Menu size={18} />
            </button>
            <span className="crumb">
              Workspace{" "}
              <span style={{ margin: "0 12px", color: "#bbc4be" }}>/</span>{" "}
              <strong style={{ color: "var(--text)" }}>{page}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="small muted">
              <span className="status-dot" />
              {data ? "Inventory connected" : "Private workspace"}
            </span>
            <button
              className="icon-button"
              aria-label="Toggle color theme"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="icon-button"
              aria-label="Log out"
              onClick={async () => {
                const r = await fetch("/api/auth", { method: "DELETE" });
                if (r.ok) location.assign("/login");
                else toast.error("Unable to log out");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-head">
            <div>
              <span className="eyebrow">
                {page === "Dashboard"
                  ? "YOUR BUSINESS, IN BALANCE"
                  : "HERBAL MAZA / " + page.toUpperCase()}
              </span>
              <h1>{page === "Dashboard" ? "Inventory overview" : page}</h1>
              <p className="muted">{descriptions[page]}</p>
            </div>
            <div className="actions">
              {page === "Products" && admin && (
                <>
                  <button
                    className="secondary"
                    onClick={() => setBulkMode("import")}
                  >
                    <FileDown size={16} />
                    Bulk import
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setBulkMode("scan")}
                  >
                    <ScanLine size={16} />
                    Scan products
                  </button>
                </>
              )}
              {page === "Dashboard" ? (
                <>
                  <button className="secondary" onClick={() => setScan(true)}>
                    <ScanLine size={16} />
                    Scan barcode
                  </button>
                  <button onClick={() => setModal({ kind: "sale" })}>
                    <Plus size={17} />
                    New sale
                  </button>
                </>
              ) : actions[page] ? (
                <>
                  <a
                    className="export-link"
                    href={
                      "/api/export?type=" +
                      ({
                        Products: "products",
                        Sales: "sales",
                        Returns: "returns",
                        Purchases: "purchases",
                        Suppliers: "suppliers",
                        Reports: "products",
                        Settings: "products",
                        "Stock Adjustments": "movements",
                      }[page] || "products")
                    }
                  >
                    <FileDown size={15} />
                    Export
                  </a>
                  {(admin ||
                    !["Products", "Purchases", "Suppliers"].includes(page)) && (
                    <button
                      onClick={() => setModal({ kind: actions[page]!.kind })}
                    >
                      <Plus size={16} />
                      {actions[page]!.label}
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}{" "}
              <button className="secondary" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}
          {!data && !error && (
            <div className="panel empty" role="status">
              Loading your inventory…
            </div>
          )}
          {data && (
            <>
              {[
                "Dashboard",
                "Sales",
                "Returns",
                "Stock Adjustments",
                "Purchases",
                "Reports",
              ].includes(page) && dateFilters}
              {reportError && ["Dashboard", "Reports"].includes(page) && (
                <div role="alert" className="error">
                  {reportError}{" "}
                  <button
                    className="secondary"
                    onClick={() => void loadReports()}
                  >
                    Retry
                  </button>
                </div>
              )}
              {page === "Dashboard" && (
                <>
                  <div className="cards">
                    {[
                      {
                        label: "Net sales",
                        value: report ? money(report.summary.netSales) : "…",
                        foot: periodLabel,
                        icon: Wallet,
                        featured: true,
                      },
                      {
                        label: "Estimated gross profit",
                        value: report ? money(report.summary.grossProfit) : "…",
                        foot: "Net sales less cost of goods sold",
                        icon: ArrowUpRight,
                      },
                      {
                        label: "Sellable stock",
                        value: qty(
                          sum(data.products, (p) => p.stock).toString(),
                        ),
                        foot: `Across ${data.products.filter((p) => p.active).length} active products · mixed units`,
                        icon: Boxes,
                      },
                      {
                        label: "Inventory value",
                        value: money(
                          sum(data.products, (p) =>
                            D(p.stock).mul(p.averageCost).toString(),
                          ),
                        ),
                        foot: "Current sellable stock · weighted average",
                        icon: Package,
                      },
                    ].map((c) => (
                      <div
                        key={c.label}
                        className={"card " + (c.featured ? "featured" : "")}
                      >
                        <div className="card-label">
                          {c.label}
                          <span className="card-icon">
                            <c.icon size={17} />
                          </span>
                        </div>
                        <div className="card-value">{c.value}</div>
                        <div className="card-foot">{c.foot}</div>
                      </div>
                    ))}
                  </div>
                  <div className="two-col">
                    <section className="panel">
                      <div className="section-head">
                        <h2>Sales performance</h2>
                        <Tag>{preset}</Tag>
                      </div>
                      <div className="metric-list">
                        <div className="small muted">
                          Net revenue
                          <strong className="accent">
                            {report ? money(report.summary.netSales) : "…"}
                          </strong>
                        </div>
                        <div className="small muted">
                          Units sold
                          <strong style={{ color: "var(--text)" }}>
                            {report ? qty(report.summary.sold) : "…"}
                          </strong>
                        </div>
                        <div className="small muted">
                          Refunds
                          <strong style={{ color: "var(--text)" }}>
                            {report ? money(report.summary.refunds) : "…"}
                          </strong>
                        </div>
                        <div className="small muted">
                          Returned quantity
                          <strong style={{ color: "var(--text)" }}>
                            {qty(
                              sum(
                                data.returns.filter((r) =>
                                  inRange(r.createdAt),
                                ),
                                (r) =>
                                  sum(r.items, (x) => x.quantity).toString(),
                              ).toString(),
                            )}
                          </strong>
                        </div>
                        <div className="small muted">
                          Damaged quantity
                          <strong style={{ color: "var(--text)" }}>
                            {qty(
                              sum(
                                data.movements.filter(
                                  (m) =>
                                    inRange(m.createdAt) &&
                                    m.bucket === "DAMAGED" &&
                                    D(m.quantity).gt(0),
                                ),
                                (m) => m.quantity,
                              ).toString(),
                            )}
                          </strong>
                        </div>
                      </div>
                      {report?.daily.length ? (
                        <div className="chart" aria-label="Daily net sales">
                          {report.daily.slice(-31).map((b) => (
                            <div
                              key={b.date}
                              className="chart-group"
                              title={b.date + ": " + money(b.netSales)}
                            >
                              <div
                                className="chart-bar"
                                style={{
                                  height:
                                    Math.max(
                                      1,
                                      (Number(b.netSales) /
                                        Math.max(
                                          ...report.daily.map((x) =>
                                            Number(x.netSales),
                                          ),
                                          1,
                                        )) *
                                        90,
                                    ) + "%",
                                }}
                              />
                              <span className="chart-label">
                                {b.date.slice(8)}/{b.date.slice(5, 7)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title={
                            report
                              ? "Your first sale starts the story"
                              : "Loading sales…"
                          }
                        >
                          Record a sale to see your daily sales performance.
                        </Empty>
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-head">
                        <h2>Top-selling products</h2>
                        <button
                          className="link-button"
                          onClick={() => go("Reports")}
                        >
                          View report{" "}
                          <ArrowRight size={12} style={{ display: "inline" }} />
                        </button>
                      </div>
                      {report?.productSales.some((p) => D(p.sold).gt(0)) ? (
                        report.productSales
                          .filter((p) => D(p.sold).gt(0))
                          .sort((a, b) => D(b.sold).cmp(a.sold))
                          .slice(0, 5)
                          .map((p, i) => (
                            <div key={p.product} className="progress-row">
                              <div>
                                <span>
                                  <span
                                    className="muted"
                                    style={{ marginRight: 10 }}
                                  >
                                    0{i + 1}
                                  </span>
                                  {p.product}
                                </span>
                                <strong>{qty(p.sold)} sold</strong>
                              </div>
                              <div className="progress-track">
                                <div
                                  className="progress-fill"
                                  style={{
                                    width:
                                      Math.max(
                                        3,
                                        (Number(p.sold) /
                                          Math.max(
                                            ...report.productSales.map((x) =>
                                              Number(x.sold),
                                            ),
                                            1,
                                          )) *
                                          100,
                                      ) + "%",
                                  }}
                                />
                              </div>
                            </div>
                          ))
                      ) : (
                        <Empty title="No sales in this period">
                          Your best-performing products will appear here.
                        </Empty>
                      )}
                    </section>
                  </div>
                  <div className="cards">
                    {[
                      [
                        "Low-stock products",
                        String(low.length),
                        "Products at or below their threshold",
                      ],
                      [
                        "Pending purchase units",
                        qty(
                          data.purchases
                            .filter((p) =>
                              ["ORDERED", "PARTIALLY_RECEIVED"].includes(
                                p.status,
                              ),
                            )
                            .reduce(
                              (v, p) =>
                                p.items.reduce(
                                  (s, x) =>
                                    s.plus(D(x.quantity).minus(x.received)),
                                  v,
                                ),
                              D(0),
                            )
                            .toString(),
                        ),
                        "Ordered stock still to arrive",
                      ],
                      [
                        "Supplier outstanding",
                        money(
                          data.purchases
                            .filter(
                              (p) => !["DRAFT", "CANCELLED"].includes(p.status),
                            )
                            .reduce(
                              (s, p) => s.plus(D(p.total).minus(p.paid)),
                              D(0),
                            ),
                        ),
                        "Agreed order totals less payments",
                      ],
                      [
                        "Stock losses",
                        report ? money(report.summary.loss) : "…",
                        "Selected period · includes unusable returns",
                      ],
                    ].map(([label, value, foot]) => (
                      <div className="card" key={label}>
                        <div className="card-label">{label}</div>
                        <div className="card-value">{value}</div>
                        <div className="card-foot">{foot}</div>
                      </div>
                    ))}
                  </div>
                  <div className="two-col">
                    <section className="panel">
                      <div className="section-head">
                        <h2>
                          Stock needs attention{" "}
                          <Tag tone="warning">{low.length}</Tag>
                        </h2>
                        <button
                          className="link-button"
                          onClick={() => {
                            go("Products");
                            setStockFilter("low");
                          }}
                        >
                          View products →
                        </button>
                      </div>
                      {low.length ? (
                        <Table
                          headers={[
                            "Product",
                            "Available",
                            "Minimum",
                            "Status",
                          ]}
                        >
                          {low.slice(0, 5).map((p) => (
                            <tr key={p.id}>
                              <td>
                                <button
                                  className="link-button"
                                  onClick={() =>
                                    setModal({
                                      kind: "productDetail",
                                      id: p.id,
                                    })
                                  }
                                >
                                  <ProductName product={p} />
                                </button>
                              </td>
                              <td className="stock-num">
                                {qty(p.stock)}{" "}
                                <span className="muted small">{p.unit}</span>
                              </td>
                              <td>{qty(p.minStock)}</td>
                              <td>
                                <Tag
                                  tone={D(p.stock).isZero() ? "bad" : "warning"}
                                >
                                  {D(p.stock).isZero()
                                    ? "Out of stock"
                                    : "Low stock"}
                                </Tag>
                              </td>
                            </tr>
                          ))}
                        </Table>
                      ) : (
                        <Empty
                          title={
                            data.products.length
                              ? "Stock levels look healthy"
                              : "Add your first product"
                          }
                        >
                          {data.products.length ? (
                            "All active products are above their minimum stock threshold."
                          ) : (
                            <button
                              onClick={() => setModal({ kind: "product" })}
                            >
                              <Plus size={15} />
                              Add product
                            </button>
                          )}
                        </Empty>
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-head">
                        <h2>Recent activity</h2>
                        <Activity size={16} className="muted" />
                      </div>
                      {data.movements.length ? (
                        data.movements.slice(0, 5).map((m) => (
                          <div className="activity-row" key={m.id}>
                            <span className="product-mark">
                              <ArrowDownToLine size={15} />
                            </span>
                            <div style={{ flex: 1 }}>
                              <strong className="small">
                                {m.product.name}
                              </strong>
                              <div className="small muted">
                                {m.type.replaceAll("_", " ")} ·{" "}
                                {date(m.createdAt)}
                              </div>
                            </div>
                            <strong className="small">
                              {D(m.quantity).gt(0) ? "+" : ""}
                              {qty(m.quantity)}
                            </strong>
                          </div>
                        ))
                      ) : (
                        <Empty title="A fresh ledger">
                          Every receipt, sale, and stock adjustment appears
                          here.
                        </Empty>
                      )}
                    </section>
                  </div>
                  <h2 style={{ marginBottom: 15 }}>Make your next move</h2>
                  <div className="quick-actions">
                    {admin && (
                      <button onClick={() => setModal({ kind: "product" })}>
                        <Package size={20} />
                        Add a product
                      </button>
                    )}
                    <button
                      onClick={() =>
                        setModal({ kind: admin ? "purchase" : "receiveSelect" })
                      }
                    >
                      <Truck size={20} />
                      {admin ? "Order / receive stock" : "Receive stock"}
                    </button>
                    <button onClick={() => setModal({ kind: "return" })}>
                      <RotateCcw size={20} />
                      Record a return
                    </button>
                    <button onClick={() => setModal({ kind: "adjustment" })}>
                      <ClipboardPlus size={20} />
                      Record stock loss
                    </button>
                  </div>
                </>
              )}
              {page === "Products" && (
                <section className="panel">
                  <div className="section-head">
                    <h2>
                      Product catalog <Tag>{data.products.length} products</Tag>
                    </h2>
                    <button className="secondary" onClick={() => setScan(true)}>
                      <ScanLine size={16} />
                      Scan barcode
                    </button>
                  </div>
                  {search}
                  {products.length ? (
                    <>
                      <Table
                        headers={[
                          "Product",
                          "Barcode",
                          "Purchase / cost",
                          "Selling price",
                          "Margin / unit",
                          "Sellable stock",
                          "Stock value",
                          "Status",
                          "Actions",
                        ]}
                      >
                        {paginate(products).map((p) => (
                          <tr key={p.id}>
                            <td>
                              <button
                                className="link-button"
                                onClick={() =>
                                  setModal({ kind: "productDetail", id: p.id })
                                }
                              >
                                <ProductName product={p} />
                              </button>
                            </td>
                            <td className="muted">{p.barcode || "—"}</td>
                            <td>
                              {money(p.purchasePrice)}
                              <div className="muted small">
                                Avg. {money(p.averageCost)}
                              </div>
                            </td>
                            <td>{money(p.sellingPrice)}</td>
                            <td>
                              {money(
                                D(p.sellingPrice).minus(
                                  D(p.stock).gt(0)
                                    ? p.averageCost
                                    : p.purchasePrice,
                                ),
                              )}
                            </td>
                            <td className="stock-num">
                              {qty(p.stock)} {p.unit}
                            </td>
                            <td>{money(D(p.stock).mul(p.averageCost))}</td>
                            <td>
                              <Tag
                                tone={
                                  !p.active
                                    ? "bad"
                                    : D(p.stock).lte(p.minStock)
                                      ? "warning"
                                      : ""
                                }
                              >
                                {!p.active
                                  ? "Archived"
                                  : D(p.stock).lte(p.minStock)
                                    ? "Low stock"
                                    : "In stock"}
                              </Tag>
                            </td>
                            <td>
                              {admin && (
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    setModal({ kind: "product", id: p.id })
                                  }
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </Table>
                      {pager(products.length)}
                    </>
                  ) : (
                    <Empty title="No products found">
                      Add a product or adjust your search.
                    </Empty>
                  )}
                </section>
              )}
              {page === "Sales" && (
                <section className="panel">
                  <h2>Sales history</h2>
                  {search}
                  {sales.length ? (
                    <>
                      <Table
                        headers={[
                          "Sale / customer",
                          "Date",
                          "Items",
                          "Net total",
                          "Status",
                          "Details",
                        ]}
                      >
                        {paginate(sales).map((s) => (
                          <tr key={s.id}>
                            <td>
                              <strong>{s.number}</strong>
                              <div className="muted small">
                                {s.customer || "Walk-in customer"}
                              </div>
                            </td>
                            <td>
                              {date(s.createdAt, data.settings.dateFormat)}
                            </td>
                            <td>{s.items.length}</td>
                            <td>{money(s.total)}</td>
                            <td>
                              <Tag tone={s.status === "CANCELLED" ? "bad" : ""}>
                                {s.status}
                              </Tag>
                            </td>
                            <td>
                              <button
                                className="secondary"
                                onClick={() =>
                                  setModal({ kind: "saleDetail", id: s.id })
                                }
                              >
                                View order
                              </button>
                            </td>
                          </tr>
                        ))}
                      </Table>
                      {pager(sales.length)}
                    </>
                  ) : (
                    <Empty title="No sales in this period">
                      Create your first order or choose another date range.
                    </Empty>
                  )}
                </section>
              )}
              {page === "Returns" && (
                <section className="panel">
                  <h2>Customer returns</h2>
                  {search}
                  {returns.length ? (
                    <>
                      <Table
                        headers={[
                          "Return",
                          "Date",
                          "Products / original sale",
                          "Condition",
                          "Refund",
                          "Reason",
                        ]}
                      >
                        {paginate(returns).map((r) => (
                          <tr key={r.id}>
                            <td>
                              <strong>{r.number}</strong>
                              <div className="small muted">
                                {r.manual
                                  ? "Manual return"
                                  : "Linked to original sale"}
                              </div>
                            </td>
                            <td>{date(r.createdAt)}</td>
                            <td>
                              {r.items.map((x) => (
                                <div key={x.id}>
                                  {x.product.name} × {qty(x.quantity)}
                                  <div className="small muted">
                                    {x.saleItem?.sale.number ||
                                      "No original sale"}{" "}
                                    · {r.notes}
                                  </div>
                                </div>
                              ))}
                            </td>
                            <td>
                              {r.items.map((x) => (
                                <div key={x.id}>
                                  <Tag
                                    tone={
                                      x.condition === "SELLABLE"
                                        ? ""
                                        : "warning"
                                    }
                                  >
                                    {x.condition}
                                  </Tag>
                                </div>
                              ))}
                            </td>
                            <td>{money(r.refund)}</td>
                            <td style={{ whiteSpace: "normal", minWidth: 180 }}>
                              {r.reason}
                            </td>
                          </tr>
                        ))}
                      </Table>
                      {pager(returns.length)}
                    </>
                  ) : (
                    <Empty title="No returns in this period">
                      Record a linked return or an audited manual return.
                    </Empty>
                  )}
                </section>
              )}
              {page === "Stock Adjustments" && (
                <section className="panel">
                  <h2>Immutable stock ledger</h2>
                  <p className="small muted">
                    All buckets are separate. Positive damaged or expired
                    movements do not increase sellable stock.
                  </p>
                  {search}
                  <MovementTable rows={paginate(movements)} />
                  {pager(movements.length)}
                </section>
              )}
              {page === "Purchases" && (
                <section className="panel">
                  <h2>Purchase orders</h2>
                  {search}
                  {purchases.length ? (
                    <>
                      <Table
                        headers={[
                          "Order / supplier",
                          "Date",
                          "Received / ordered",
                          "Order total",
                          "Outstanding",
                          "Status",
                          "Details",
                        ]}
                      >
                        {paginate(purchases).map((p) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.number}</strong>
                              <div className="small muted">
                                {p.supplier.name}
                              </div>
                            </td>
                            <td>{date(p.createdAt)}</td>
                            <td>
                              {qty(sum(p.items, (x) => x.received).toString())}{" "}
                              /{" "}
                              {qty(sum(p.items, (x) => x.quantity).toString())}
                            </td>
                            <td>{money(p.total)}</td>
                            <td>{money(D(p.total).minus(p.paid))}</td>
                            <td>
                              <Tag
                                tone={
                                  p.status === "CANCELLED"
                                    ? "bad"
                                    : p.status === "RECEIVED"
                                      ? ""
                                      : "warning"
                                }
                              >
                                {p.status.replaceAll("_", " ")}
                              </Tag>
                            </td>
                            <td>
                              <button
                                className="secondary"
                                onClick={() =>
                                  setModal({ kind: "purchaseDetail", id: p.id })
                                }
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))}
                      </Table>
                      {pager(purchases.length)}
                    </>
                  ) : (
                    <Empty title="No purchases in this period">
                      Create an order, then record deliveries as they arrive.
                    </Empty>
                  )}
                </section>
              )}
              {page === "Suppliers" && (
                <section className="panel">
                  <h2>Your suppliers</h2>
                  {search}
                  {suppliers.length ? (
                    <>
                      <Table
                        headers={[
                          "Supplier",
                          "Contact",
                          "Orders",
                          "Purchased",
                          "Outstanding",
                          "Status",
                          "Actions",
                        ]}
                      >
                        {paginate(suppliers).map((s) => {
                          const orders = data.purchases.filter(
                            (p) =>
                              p.supplierId === s.id &&
                              !["DRAFT", "CANCELLED"].includes(p.status),
                          );
                          return (
                            <tr key={s.id}>
                              <td>
                                <strong>{s.name}</strong>
                              </td>
                              <td>
                                {s.contact || "—"}
                                <div className="muted small">
                                  {s.phone || s.email}
                                </div>
                              </td>
                              <td>{orders.length}</td>
                              <td>{money(sum(orders, (p) => p.total))}</td>
                              <td>
                                {money(
                                  sum(orders, (p) =>
                                    D(p.total).minus(p.paid).toString(),
                                  ),
                                )}
                              </td>
                              <td>
                                <Tag tone={s.active ? "" : "bad"}>
                                  {s.active ? "Active" : "Inactive"}
                                </Tag>
                              </td>
                              <td>
                                <div className="actions">
                                  <button
                                    className="secondary"
                                    onClick={() =>
                                      setModal({
                                        kind: "supplierDetail",
                                        id: s.id,
                                      })
                                    }
                                  >
                                    History
                                  </button>
                                  {admin && (
                                    <button
                                      className="secondary"
                                      onClick={() =>
                                        setModal({ kind: "supplier", id: s.id })
                                      }
                                    >
                                      Edit
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </Table>
                      {pager(suppliers.length)}
                    </>
                  ) : (
                    <Empty title="No suppliers found">
                      Add a manufacturer or supplier to start ordering.
                    </Empty>
                  )}
                </section>
              )}
              {page === "Reports" && (
                <Reports report={report} from={from} to={to} />
              )}
              {page === "Settings" && (
                <>
                  {admin && <SettingsPage data={data} onSaved={load} />}
                  <Accounts admin={admin} />
                </>
              )}
            </>
          )}
          <p className="footer-note">
            <ShieldCheck
              size={12}
              style={{
                display: "inline",
                verticalAlign: "middle",
                marginRight: 5,
              }}
            />
            Private inventory workspace · Weighted-average costing · All times
            in Asia/Kolkata
          </p>
        </div>
      </main>
      {modal && data && (
        <Workflow
          key={JSON.stringify(modal)}
          modal={modal}
          data={data}
          onClose={() => setModal(null)}
          onOpen={setModal}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
      {scan && <Scanner onScan={onScan} onClose={() => setScan(false)} />}
      {bulkMode && data && (
        <BulkProducts
          mode={bulkMode}
          data={data}
          onClose={() => setBulkMode(null)}
          onSaved={async () => {
            setBulkMode(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
function MovementTable({ rows }: { rows: Data["movements"] }) {
  return rows.length ? (
    <Table
      headers={[
        "Date",
        "Product",
        "Movement",
        "Bucket",
        "Quantity",
        "Unit cost",
        "Reference / reason",
      ]}
    >
      {rows.map((m) => (
        <tr key={m.id}>
          <td>
            {date(m.createdAt)}
            <div className="small muted">
              {new Date(m.createdAt).toLocaleTimeString("en-IN", {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </td>
          <td>{m.product.name}</td>
          <td>{m.type.replaceAll("_", " ")}</td>
          <td>
            <Tag tone={m.bucket === "SELLABLE" ? "" : "warning"}>
              {m.bucket}
            </Tag>
          </td>
          <td>
            {D(m.quantity).gt(0) ? "+" : ""}
            {qty(m.quantity)}
          </td>
          <td>{money(m.unitCost)}</td>
          <td style={{ whiteSpace: "normal", minWidth: 160 }}>
            <span className="small muted">{m.reference}</span>
            <div>{m.reason}</div>
          </td>
        </tr>
      ))}
    </Table>
  ) : (
    <Empty title="No stock movements found" />
  );
}
async function post(body: unknown) {
  const r = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Unable to save");
  return result;
}
function Reports({
  report,
  from,
  to,
}: {
  report: ReportData | null;
  from: string;
  to: string;
}) {
  const [type, setType] = useState<
    | keyof Pick<
        ReportData,
        "daily" | "productSales" | "stock" | "purchase" | "valuation" | "losses"
      >
    | "monthly"
  >("daily");
  const names = {
    daily: "Daily sales",
    productSales: "Product sales",
    stock: "Stock reconciliation",
    purchase: "Purchases",
    valuation: "Valuation",
    losses: "Stock losses",
    monthly: "Period / monthly summary",
  };
  const [lossGrouping, setLossGrouping] = useState("entries");
  let rows: Record<string, unknown>[] = report
    ? type === "monthly"
      ? [report.summary]
      : report[type]
    : [];
  if (type === "losses" && lossGrouping !== "entries") {
    const groups = new Map<
      string,
      {
        group: string;
        quantity: ReturnType<typeof D>;
        loss: ReturnType<typeof D>;
      }
    >();
    for (const x of report?.losses || []) {
      const key = x[lossGrouping as "product" | "reason" | "date"];
      const g = groups.get(key) || { group: key, quantity: D(0), loss: D(0) };
      g.quantity = g.quantity.plus(x.quantity);
      g.loss = g.loss.plus(x.loss);
      groups.set(key, g);
    }
    rows = [...groups.values()].map((x) => ({
      group: x.group,
      quantity: x.quantity.toString(),
      loss: x.loss.toFixed(2),
    }));
  }
  return (
    <>
      <div className="report-tabs">
        {Object.entries(names).map(([k, v]) => (
          <button
            className={type === k ? "" : "secondary"}
            key={k}
            onClick={() => setType(k as typeof type)}
          >
            {v}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="section-head">
          <h2>{names[type]}</h2>
          <a
            className="export-link"
            href={`/api/reports?from=${from}&to=${to}&type=${type}&format=csv`}
          >
            <FileDown size={15} />
            Download CSV
          </a>
        </div>
        {type === "losses" && (
          <label style={{ maxWidth: 230 }}>
            Group losses
            <select
              value={lossGrouping}
              onChange={(e) => setLossGrouping(e.target.value)}
            >
              <option value="entries">Individual entries</option>
              <option value="product">By product</option>
              <option value="reason">By reason</option>
              <option value="date">By date</option>
            </select>
          </label>
        )}
        {!report ? (
          <div role="status" className="empty">
            Loading report…
          </div>
        ) : rows.length ? (
          <Table
            headers={Object.keys(rows[0]).map((k) =>
              k.replace(/([A-Z])/g, " $1"),
            )}
          >
            {rows.map((r, i) => (
              <tr key={i}>
                {Object.values(r).map((v, j) => (
                  <td key={j}>{String(v ?? "—")}</td>
                ))}
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No records in this date range" />
        )}
        <div className="notice">
          Amounts are in INR. Gross sales − discounts − refunds = net sales. Net
          sales − historical weighted-average cost of goods sold = estimated
          gross profit. Inventory losses are shown separately; these figures are
          not net profit. Linked returns reverse original COGS, and unusable
          returns create a separate loss. Manual returns do not reverse COGS.
        </div>
        <p className="small muted">
          Activity reports use event dates in Asia/Kolkata, including
          cancellation reversal dates. Stock and valuation close at the end
          date. Purchases show orders created in the period and their current
          fulfillment/payment status. To view a calendar month, choose This
          month, Previous month, or a custom month range. Loss CSV contains
          individual entries.
        </p>
      </section>
    </>
  );
}
function SettingsPage({
  data,
  onSaved,
}: {
  data: Data;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <section className="panel" style={{ maxWidth: 760 }}>
        <h2>Workspace preferences</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const fd = new FormData(e.currentTarget);
              await post({ action: "settings", data: Object.fromEntries(fd) });
              await onSaved();
              toast.success("Settings saved");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Unable to save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid" style={{ marginTop: 25 }}>
            <Field
              name="name"
              label="Inventory / business name"
              required
              value={data.settings.name}
            />
            <Field
              label="Default low-stock threshold"
              name="minStock"
              type="number"
              min="0"
              step="0.001"
              required
              value={data.settings.minStock}
            />
            <label>
              Currency
              <input disabled value="INR (₹)" />
            </label>
            <label>
              Date format
              <select name="dateFormat" defaultValue={data.settings.dateFormat}>
                <option value="dd/MM/yyyy">Day / month / year</option>
                <option value="yyyy-MM-dd">Year-month-day</option>
              </select>
            </label>
          </div>
          <div className="notice">
            Costing method: perpetual weighted average. Historical sale costs
            are preserved. The costing method is fixed to protect historical
            reports. New low-stock defaults apply to newly created products.
          </div>
          <button disabled={busy}>
            {busy ? "Saving…" : "Save preferences"}
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Export your data</h2>
        <p className="muted small" style={{ margin: "8px 0 20px" }}>
          CSV exports are useful for review. Use a MySQL database backup for a
          complete, restorable copy.
        </p>
        <div className="actions">
          {[
            "products",
            "balances",
            "sales",
            "saleItems",
            "purchases",
            "purchaseItems",
            "receipts",
            "returns",
            "movements",
            "payments",
          ].map((t) => (
            <a className="export-link" key={t} href={"/api/export?type=" + t}>
              <FileDown size={14} />
              {t.replace(/([A-Z])/g, " $1")}
            </a>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Account & backup</h2>
        <p style={{ margin: "12px 0" }} className="muted">
          Login sessions expire after 12 hours. Use the server password-reset
          command to change your password and revoke every session.
        </p>
        <p className="small muted">
          Keep encrypted daily MySQL backups outside the application host.
          Retain 7 daily and 4 weekly backups, and test a restore into a
          separate database monthly. Follow the verified commands in README.md.
          Automated provider backups have not been configured by this
          application.
        </p>
      </section>
      <section className="panel">
        <h2>Recent audit history</h2>
        <Table headers={["Date", "Action", "Reference"]}>
          {data.audit.slice(0, 20).map((a) => (
            <tr key={a.id}>
              <td>{date(a.createdAt)}</td>
              <td>{a.action}</td>
              <td className="small muted">{a.reference}</td>
            </tr>
          ))}
        </Table>
      </section>
    </>
  );
}

function EntityForm({
  kind,
  record,
  barcode,
  onSubmit,
  busy,
}: {
  kind: "product" | "supplier";
  record?: Record<string, unknown>;
  barcode?: string;
  onSubmit: (body: unknown) => Promise<void>;
  busy: boolean;
}) {
  const fields =
    kind === "product"
      ? [
          "name",
          "sku",
          "barcode",
          "category",
          "unit",
          "purchasePrice",
          "sellingPrice",
          "minStock",
        ]
      : ["name", "contact", "phone", "email", "address"];
  const labels: Record<string, string> = {
    name: kind === "product" ? "Product name" : "Supplier name",
    sku: "SKU / internal code",
    barcode: "Barcode (optional)",
    category: "Category (optional)",
    unit: "Unit of measure",
    purchasePrice: "Reference purchase price (₹)",
    sellingPrice: "Selling price (₹)",
    minStock: "Minimum stock threshold",
    contact: "Contact person",
    phone: "Phone number",
    email: "Email address",
    address: "Address",
  };
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Record<string, string | boolean>>({
    defaultValues: {
      unit: "pcs",
      purchasePrice: "0",
      sellingPrice: "0",
      active: true,
      ...Object.fromEntries(
        Object.entries(record || {}).map(([k, v]) => [k, v ?? ""]),
      ),
      ...(barcode ? { barcode } : {}),
    },
  });
  return (
    <form
      onSubmit={handleSubmit((values) =>
        onSubmit({
          action: kind,
          id: record?.id,
          data: {
            ...values,
            ...(kind === "product" && values.minStock === ""
              ? { minStock: undefined }
              : {}),
          },
        }),
      )}
    >
      <div className="form-grid">
        {fields.map((name) => (
          <label key={name}>
            {labels[name]}
            <input
              {...register(name, {
                required: [
                  "name",
                  "unit",
                  "purchasePrice",
                  "sellingPrice",
                ].includes(name),
              })}
              type={
                ["purchasePrice", "sellingPrice", "minStock"].includes(name)
                  ? "number"
                  : name === "email"
                    ? "email"
                    : "text"
              }
              min="0"
              step={name === "minStock" ? "0.001" : "0.0001"}
              maxLength={name === "unit" ? 32 : 191}
            />
            {errors[name] && (
              <span className="error">This field is required</span>
            )}
          </label>
        ))}
      </div>
      <label>
        Notes
        <textarea {...register("notes")} maxLength={2000} />
      </label>
      <label className="check-label">
        <input type="checkbox" {...register("active")} />
        Active {kind}
      </label>
      {kind === "product" && (
        <p className="small muted">
          New products start at zero stock. Use “Opening stock” on the product
          details page to record existing inventory. Untick Active to archive
          while preserving history.
        </p>
      )}
      <div className="form-footer">
        <button disabled={busy}>
          {busy ? "Saving…" : record ? "Save changes" : "Create " + kind}
        </button>
      </div>
    </form>
  );
}
type CartLine = {
  productId: string;
  quantity: string;
  unitCost: string;
  discount: string;
  override: boolean;
  overridePrice: string;
  overrideReason: string;
};
function Cart({
  data,
  purchase,
  lines,
  setLines,
}: {
  data: Data;
  purchase: boolean;
  lines: CartLine[];
  setLines: (rows: CartLine[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [unknown, setUnknown] = useState("");
  const add = useCallback(
    (id: string) => {
      setUnknown("");
      const p = data.products.find((x) => x.id === id);
      if (!p?.active) {
        toast.error("Product is archived or unavailable");
        return;
      }
      const existing = lines.find((x) => x.productId === id);
      if (existing)
        setLines(
          lines.map((x) =>
            x.productId === id
              ? {
                  ...x,
                  quantity: D(x.quantity || "0")
                    .plus(1)
                    .toString(),
                }
              : x,
          ),
        );
      else
        setLines([
          ...lines,
          {
            productId: id,
            quantity: "1",
            unitCost: p.purchasePrice,
            discount: "0",
            override: false,
            overridePrice: p.sellingPrice,
            overrideReason: "",
          },
        ]);
      setSearch("");
    },
    [data.products, lines, setLines],
  );
  const onScan = useCallback(
    (code: string) => {
      setScanning(false);
      const p = data.products.find((x) => x.barcode === code);
      if (p) add(p.id);
      else {
        setUnknown(code);
        toast.error("Barcode is not registered");
      }
    },
    [data.products, add],
  );
  const patch = (index: number, values: Partial<CartLine>) =>
    setLines(lines.map((x, j) => (j === index ? { ...x, ...values } : x)));
  let total = D(0);
  for (const l of lines) {
    const p = data.products.find((x) => x.id === l.productId);
    try {
      total = total.plus(
        D(l.quantity || "0")
          .mul(
            purchase
              ? l.unitCost || "0"
              : l.override
                ? l.overridePrice || "0"
                : p?.sellingPrice || "0",
          )
          .minus(purchase ? "0" : l.discount || "0"),
      );
    } catch {}
  }
  return (
    <>
      <div className="filters">
        <input
          aria-label="Search or scan products"
          placeholder="Search name, SKU, or scan barcode and press Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const p = data.products.find(
                (p) => p.barcode === search.trim() || p.sku === search.trim(),
              );
              if (p) add(p.id);
              else {
                setUnknown(search.trim());
                toast.error(
                  "Product not found. Select a search result or create a product.",
                );
              }
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          onClick={() => setScanning(true)}
        >
          <ScanLine size={16} />
          Scan
        </button>
      </div>
      {search && (
        <div className="search-results">
          {data.products
            .filter(
              (p) =>
                p.active &&
                [p.name, p.sku, p.barcode]
                  .join(" ")
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            )
            .slice(0, 8)
            .map((p) => (
              <button
                key={p.id}
                className="secondary"
                type="button"
                onClick={() => add(p.id)}
              >
                {p.name}{" "}
                <span className="muted small">
                  {qty(p.stock)} available · {money(p.sellingPrice)}
                </span>
                <Plus size={14} />
              </button>
            ))}
        </div>
      )}
      {unknown && (
        <div className="notice">
          Unknown barcode: {unknown}.{" "}
          <a
            href={"/?barcode=" + encodeURIComponent(unknown) + "#Products"}
            target="_blank"
            rel="noreferrer"
          >
            Open products to create a product and assign this barcode
          </a>
          , then refresh before recording the sale.
        </div>
      )}
      {!lines.length && (
        <Empty title="Add products to this order">
          Search above, scan a barcode, or use the product selector below.
        </Empty>
      )}
      {!search && (
        <StockSelect products={data.products} name="lookup" onChange={add} />
      )}
      {lines.map((l, index) => {
        const p = data.products.find((x) => x.id === l.productId)!;
        return (
          <div key={l.productId} className="cart-item">
            <div className="line-item">
              <div>
                <strong>{p.name}</strong>
                <div className="small muted">
                  {qty(p.stock)} {p.unit} in stock
                </div>
              </div>
              <label>
                Quantity
                <input
                  required
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={l.quantity}
                  onChange={(e) => patch(index, { quantity: e.target.value })}
                />
              </label>
              {purchase ? (
                <label>
                  Unit cost (₹)
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.0001"
                    value={l.unitCost}
                    onChange={(e) => patch(index, { unitCost: e.target.value })}
                  />
                </label>
              ) : (
                <>
                  <label>
                    Unit price (₹)
                    <input
                      disabled={!l.override}
                      type="number"
                      required
                      min="0"
                      step="0.0001"
                      value={l.override ? l.overridePrice : p.sellingPrice}
                      onChange={(e) =>
                        patch(index, { overridePrice: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Line discount (₹)
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.0001"
                      readOnly={data.user.role !== "ADMIN"}
                      value={l.discount}
                      onChange={(e) =>
                        patch(index, { discount: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={"Remove " + p.name}
                onClick={() => setLines(lines.filter((_, j) => j !== index))}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {!purchase && data.user.role === "ADMIN" && (
              <div style={{ margin: "10px 0" }}>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={l.override}
                    onChange={(e) =>
                      patch(index, { override: e.target.checked })
                    }
                  />
                  Override current selling price (audited)
                </label>
              </div>
            )}
          </div>
        );
      })}
      <div className="order-total">
        <span>Order total</span>
        <strong>{money(total)}</strong>
      </div>
      {scanning && (
        <Scanner onScan={onScan} onClose={() => setScanning(false)} />
      )}
    </>
  );
}

function Workflow({
  modal,
  data,
  onClose,
  onOpen,
  onSaved,
}: {
  modal: Modal;
  data: Data;
  onClose: () => void;
  onOpen: (m: Modal) => void;
  onSaved: () => Promise<void>;
}) {
  const admin = data.user.role === "ADMIN";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<CartLine[]>([]);
  const [returnSale, setReturnSale] = useState(
    modal.kind === "return"
      ? modal.id ||
          (admin
            ? ""
            : data.sales.find((x) => x.status === "COMPLETED")?.id || "")
      : "",
  );
  const [returnItem, setReturnItem] = useState("");
  const [adjustProduct, setAdjustProduct] = useState(modal.id || "");
  const save = async (body: unknown) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await post(body);
      toast.success("Saved successfully");
      await onSaved();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to save";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  const form = (
    handler: (fd: FormData) => unknown,
    children: ReactNode,
    label = "Confirm and save",
  ) => (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("reason", `Automatic entry: ${modal.kind}`);
        void save(handler(fd));
      }}
    >
      {children}
      <div className="form-footer">
        <span className="small muted">Confirm the details before saving.</span>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button disabled={busy}>{busy ? "Saving…" : label}</button>
      </div>
    </form>
  );
  const p = data.products.find((p) => p.id === modal.id);
  const s = data.sales.find((s) => s.id === modal.id);
  const po = data.purchases.find((p) => p.id === modal.id);
  const supplier = data.suppliers.find((s) => s.id === modal.id);
  const title: Record<string, string> = {
    bucketAdjustment: "Inspect / dispose unusable stock",
    receiveSelect: "Select an order to receive",
    product: modal.id ? "Edit product" : "Add a product",
    supplier: modal.id ? "Edit supplier" : "Add a supplier",
    sale: "New sale",
    purchase: "New purchase order",
    receipt: "Receive stock",
    return: "Record a customer return",
    adjustment: "Record a stock adjustment",
    payment: "Record supplier payment",
    cancelSale: "Cancel sale",
    cancelOrder: "Cancel purchase order",
    placeOrder: "Place draft order",
    productDetail: p?.name || "Product details",
    saleDetail: s?.number || "Sale details",
    purchaseDetail: po?.number || "Purchase details",
    supplierDetail: supplier?.name || "Supplier details",
  };
  const selectedSale = data.sales.find((x) => x.id === returnSale);
  const selectedItem = selectedSale?.items.find((x) => x.id === returnItem);
  return (
    <Dialog
      title={title[modal.kind] || "Inventory"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide={[
        "sale",
        "purchase",
        "productDetail",
        "saleDetail",
        "purchaseDetail",
        "supplierDetail",
      ].includes(modal.kind)}
    >
      {error && (
        <p role="alert" className="error" style={{ marginBottom: 18 }}>
          {error}
        </p>
      )}
      {(modal.kind === "product" || modal.kind === "supplier") && (
        <EntityForm
          kind={modal.kind}
          record={
            (modal.kind === "product" ? p : supplier) as unknown as
              Record<string, unknown> | undefined
          }
          barcode={modal.barcode}
          onSubmit={save}
          busy={busy}
        />
      )}
      {modal.kind === "receiveSelect" && (
        <div className="search-results">
          {data.purchases
            .filter((p) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(p.status))
            .map((p) => (
              <button
                className="secondary"
                key={p.id}
                onClick={() => onOpen({ kind: "receipt", id: p.id })}
              >
                {p.number} ? {p.supplier.name}
                <ArrowRight size={15} />
              </button>
            ))}
          {!data.purchases.some((p) =>
            ["ORDERED", "PARTIALLY_RECEIVED"].includes(p.status),
          ) && <Empty title="No orders awaiting delivery" />}
        </div>
      )}
      {modal.kind === "bucketAdjustment" &&
        p &&
        form(
          (fd) => ({
            action: "bucketAdjustment",
            requestKey,
            productId: p.id,
            ...Object.fromEntries(fd),
          }),
          <>
            <p className="notice">
              Damaged: {qty(p.damaged)} ? Expired: {qty(p.expired)} ?
              Quarantined: {qty(p.quarantined)}. Only inspected quarantined
              items can return to sellable stock. Disposals preserve the
              stock-loss history.
            </p>
            <div className="form-grid">
              <label>
                Bucket
                <select name="bucket">
                  <option value="QUARANTINED">Quarantined</option>
                  <option value="DAMAGED">Damaged</option>
                  <option value="EXPIRED">Expired</option>
                </select>
              </label>
              <label>
                Operation
                <select name="type">
                  <option value="RELEASE">
                    Release after inspection (quarantine only)
                  </option>
                  <option value="DISPOSE">Dispose unusable stock</option>
                </select>
              </label>
              <Field
                label="Quantity"
                name="quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
              />
            </div>
            <Notes
              name="reason"
              label="Inspection outcome / disposal authorization"
            />
          </>,
          "Confirm bucket adjustment",
        )}
      {modal.kind === "sale" &&
        form(
          (fd) => ({
            action: "sale",
            requestKey,
            customer: fd.get("customer"),
            notes: fd.get("notes"),
            items: lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              discount: l.discount,
              ...(l.override
                ? {
                    overridePrice: l.overridePrice,
                    overrideReason: "Automatic entry: selling price override",
                  }
                : {}),
            })),
          }),
          <>
            <Field name="customer" label="Customer / reference (optional)" />
            <Cart
              data={data}
              purchase={false}
              lines={lines}
              setLines={setLines}
            />
            <Notes />
            <div className="notice">
              Stock availability and current prices are checked on the server.
              Saving records the sale and deducts sellable stock together.
            </div>
          </>,
          "Confirm sale",
        )}
      {modal.kind === "purchase" &&
        form(
          (fd) => ({
            action: "purchase",
            requestKey,
            supplierId: fd.get("supplierId"),
            status: fd.get("status"),
            ...(fd.get("expectedAt")
              ? { expectedAt: fd.get("expectedAt") }
              : {}),
            notes: fd.get("notes"),
            items: lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitCost: l.unitCost,
            })),
          }),
          <>
            <div className="form-grid">
              <label>
                Supplier
                <select name="supplierId" required defaultValue="">
                  <option value="" disabled>
                    Select supplier
                  </option>
                  {data.suppliers
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Status
                <select name="status">
                  <option value="ORDERED">Ordered</option>
                  <option value="DRAFT">Draft</option>
                </select>
              </label>
              <Field
                label="Expected delivery (optional)"
                name="expectedAt"
                type="date"
              />
            </div>
            {!data.suppliers.length && (
              <p className="notice">Add a supplier before creating an order.</p>
            )}
            <Cart data={data} purchase lines={lines} setLines={setLines} />
            <Notes />
            <div className="notice">
              Ordered stock is not available for sale until you record a
              delivery. Order totals use agreed item costs; actual receipt costs
              are preserved separately for inventory valuation.
            </div>
          </>,
          "Save purchase order",
        )}
      {modal.kind === "adjustment" &&
        form(
          (fd) => ({
            action: "adjustment",
            requestKey,
            ...Object.fromEntries(fd),
            ...(fd.get("unitCost") ? {} : { unitCost: undefined }),
          }),
          <>
            <StockSelect
              products={data.products}
              defaultValue={modal.id}
              onChange={setAdjustProduct}
            />
            {adjustProduct && (
              <p className="notice">
                Current sellable stock:{" "}
                {qty(
                  data.products.find((p) => p.id === adjustProduct)?.stock ||
                    "0",
                )}
                . Stock cannot become negative.
              </p>
            )}
            <div className="form-grid">
              <label>
                Adjustment type
                <select
                  name="type"
                  defaultValue={modal.id && admin ? "OPENING" : "DAMAGED"}
                >
                  {admin && (
                    <option value="OPENING">
                      Opening stock (first movement only)
                    </option>
                  )}
                  <option value="DAMAGED">Damaged stock</option>
                  <option value="EXPIRED">Expired stock</option>
                  <option value="MISSING">Missing stock</option>
                  <option value="THEFT">Theft / unexplained shortage</option>
                  <option value="WRITE_OFF">Stock write-off</option>
                  {admin && (
                    <>
                      <option value="CORRECTION_OUT">
                        Correction: remove sellable stock
                      </option>
                      <option value="CORRECTION_IN">
                        Correction: add sellable stock
                      </option>
                      <option value="RECOVERY">
                        Recovery from outside tracked buckets
                      </option>
                    </>
                  )}
                </select>
              </label>
              <Field
                label="Quantity"
                name="quantity"
                required
                type="number"
                min="0.001"
                step="0.001"
              />
              <Field
                label="Unit cost for incoming stock (₹, optional)"
                name="unitCost"
                type="number"
                min="0"
                step="0.0001"
              />
            </div>
            <Notes
              label="Reason / authorization (at least 5 characters)"
              name="reason"
            />
            <div className="notice">
              Incoming cost defaults to the product’s reference purchase price.
              Damaged and expired adjustments transfer stock out of sellable
              inventory into separate buckets. Recovery adds externally
              recovered stock; it does not release quarantined or damaged items.
            </div>
          </>,
          "Confirm adjustment",
        )}
      {modal.kind === "return" &&
        form(
          (fd) => ({
            action: "return",
            requestKey,
            reason: fd.get("reason"),
            notes: fd.get("notes"),
            items: [
              {
                productId: selectedItem?.productId || fd.get("productId"),
                ...(selectedItem ? { saleItemId: selectedItem.id } : {}),
                quantity: fd.get("quantity"),
                condition: fd.get("condition"),
                ...(fd.get("refund") ? { refund: fd.get("refund") } : {}),
              },
            ],
          }),
          <>
            <label>
              Original sale
              <select
                value={returnSale}
                onChange={(e) => {
                  setReturnSale(e.target.value);
                  setReturnItem("");
                }}
              >
                {admin ? (
                  <option value="">Manual return — no original sale</option>
                ) : (
                  <option value="" disabled>
                    Select an original sale
                  </option>
                )}
                {data.sales
                  .filter((s) => s.status === "COMPLETED")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.number} · {s.customer || "Walk-in"} ·{" "}
                      {date(s.createdAt)}
                    </option>
                  ))}
              </select>
            </label>
            {selectedSale ? (
              <label>
                Sale item
                <select
                  required
                  value={returnItem}
                  onChange={(e) => setReturnItem(e.target.value)}
                >
                  <option value="" disabled>
                    Select sold product
                  </option>
                  {selectedSale.items.map((x) => (
                    <option
                      key={x.id}
                      value={x.id}
                      disabled={D(x.quantity).eq(x.returned)}
                    >
                      {x.product.name} ·{" "}
                      {qty(D(x.quantity).minus(x.returned).toString())}{" "}
                      remaining
                    </option>
                  ))}
                </select>
              </label>
            ) : admin ? (
              <>
                <div className="notice">
                  Manual return: no original sale is available. Record the
                  refund explicitly. This is audited and does not reverse
                  historical COGS.
                </div>
                <StockSelect products={data.products} />
              </>
            ) : (
              <Empty title="No original sale selected">
                Choose an original sale to record a return. Ask an admin to
                record a manual return.
              </Empty>
            )}
            <div className="form-grid">
              <Field
                label="Quantity returned"
                name="quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
              />
              <label>
                Condition
                <select name="condition">
                  <option value="SELLABLE">Sellable</option>
                  <option value="DAMAGED">Damaged</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="QUARANTINED">
                    Quarantined / awaiting inspection
                  </option>
                </select>
              </label>
              <Field
                label={
                  selectedItem
                    ? "Refund (₹, blank = proportional original price)"
                    : "Refund (₹, blank = no refund)"
                }
                name="refund"
                type="number"
                min="0"
                step="0.0001"
              />
            </div>
            <Notes
              name="reason"
              label="Return reason (at least 5 characters)"
            />
            <Notes />
            <p className="small muted">
              Only sellable returns increase available stock. Linked returns
              cannot exceed the remaining sold quantity or original discounted
              price.
            </p>
          </>,
          "Confirm return",
        )}
      {modal.kind === "receipt" &&
        po &&
        form(
          (fd) => ({
            action: "receipt",
            requestKey,
            orderId: po.id,
            items: po.items
              .filter((x) => D(String(fd.get(x.id) || "0")).gt(0))
              .map((x) => ({
                orderItemId: x.id,
                quantity: fd.get(x.id),
                unitCost: fd.get("cost-" + x.id),
              })),
          }),
          <>
            <p className="notice">
              Enter only the quantities delivered now. Leave other quantities at
              zero. The server prevents over-receiving.
            </p>
            {po.items
              .filter((x) => D(x.quantity).gt(x.received))
              .map((x) => (
                <div key={x.id} className="line-item">
                  <div>
                    <strong>{x.product.name}</strong>
                    <div className="muted small">
                      Pending: {qty(D(x.quantity).minus(x.received).toString())}
                    </div>
                  </div>
                  <Field
                    name={x.id}
                    label="Received now"
                    value="0"
                    type="number"
                    min="0"
                    step="0.001"
                  />
                  <Field
                    name={"cost-" + x.id}
                    label="Actual unit cost (₹)"
                    readOnly={!admin}
                    value={x.unitCost}
                    type="number"
                    min="0"
                    step="0.0001"
                    required
                  />
                </div>
              ))}
          </>,
          "Confirm receipt",
        )}
      {modal.kind === "payment" &&
        po &&
        form(
          (fd) => ({
            action: "payment",
            requestKey,
            orderId: po.id,
            ...Object.fromEntries(fd),
          }),
          <>
            <div className="notice">
              Outstanding: {money(D(po.total).minus(po.paid))}. Payments are
              independent of receiving stock.
            </div>
            <div className="form-grid">
              <Field
                name="amount"
                label="Amount paid (₹)"
                type="number"
                min="0.0001"
                step="0.0001"
                required
              />
              <label>
                Payment method
                <select name="method">
                  <option>UPI</option>
                  <option>Bank transfer</option>
                  <option>Cash</option>
                  <option>Card</option>
                  <option>Other</option>
                </select>
              </label>
            </div>
            <Field name="reference" label="Payment reference (optional)" />
          </>,
          "Confirm payment",
        )}
      {["cancelSale", "cancelOrder", "placeOrder"].includes(modal.kind) &&
        form(
          (fd) => ({
            action: modal.kind === "cancelSale" ? "cancelSale" : "orderStatus",
            requestKey,
            ...(modal.kind === "cancelSale"
              ? { saleId: modal.id }
              : {
                  orderId: modal.id,
                  status:
                    modal.kind === "cancelOrder" ? "CANCELLED" : "ORDERED",
                }),
            reason: fd.get("reason"),
          }),
          <>
            <div className="notice">
              {modal.kind === "cancelSale"
                ? "This reverses the original stock deductions at their historical cost and preserves the sale. Sales with returns cannot be cancelled."
                : modal.kind === "cancelOrder"
                  ? "Only unpaid orders with no stock received can be cancelled. The original order remains in history."
                  : "This places the draft order. Stock will increase only when a delivery is recorded."}
            </div>
            <Notes
              name="reason"
              label="Reason / confirmation (at least 5 characters)"
            />
          </>,
          "Confirm " + (modal.kind === "placeOrder" ? "order" : "cancellation"),
        )}
      {modal.kind === "productDetail" && p && (
        <>
          <div className="section-head">
            <Tag>
              {p.active ? "Active" : "Archived"} · {p.sku || "No SKU"}
            </Tag>
            <div className="actions">
              {admin && (
                <>
                  <button
                    className="secondary"
                    onClick={() => onOpen({ kind: "product", id: p.id })}
                  >
                    Edit product
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      onOpen({ kind: "bucketAdjustment", id: p.id })
                    }
                  >
                    Inspect / dispose
                  </button>
                </>
              )}
              <button onClick={() => onOpen({ kind: "adjustment", id: p.id })}>
                <Plus size={15} />
                {admin ? "Opening / adjust stock" : "Record loss"}
              </button>
            </div>
          </div>
          <div className="detail-grid">
            {[
              ["Sellable stock", qty(p.stock) + " " + p.unit],
              ["Weighted-average cost", money(p.averageCost)],
              ["Selling price", money(p.sellingPrice)],
              ["Damaged", qty(p.damaged)],
              ["Expired", qty(p.expired)],
              ["Quarantined", qty(p.quarantined)],
            ].map(([k, v]) => (
              <div key={k}>
                <span className="small muted">{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <p className="muted small">
            Barcode: {p.barcode || "Not assigned"} · Category:{" "}
            {p.category || "—"} · {p.notes}
          </p>
          <h3 style={{ margin: "25px 0 12px" }}>Complete stock history</h3>
          <MovementTable
            rows={data.movements.filter((m) => m.productId === p.id)}
          />
        </>
      )}
      {modal.kind === "saleDetail" && s && (
        <>
          <SaleDetails sale={s} />
          <div className="actions" style={{ marginTop: 20 }}>
            {s.status === "COMPLETED" && (
              <>
                <button
                  className="secondary"
                  onClick={() => onOpen({ kind: "return", id: s.id })}
                >
                  <RotateCcw size={15} />
                  Record return
                </button>
                {admin && (
                  <button
                    className="danger"
                    onClick={() => onOpen({ kind: "cancelSale", id: s.id })}
                  >
                    Cancel sale
                  </button>
                )}
              </>
            )}
          </div>
          {s.cancelReason && (
            <p className="notice">
              Cancelled {date(s.cancelledAt!)}: {s.cancelReason}
            </p>
          )}
        </>
      )}
      {modal.kind === "purchaseDetail" && po && (
        <PurchaseDetails purchase={po} onOpen={onOpen} admin={admin} />
      )}
      {modal.kind === "supplierDetail" && supplier && (
        <>
          <p className="muted">
            {supplier.contact} · {supplier.phone} · {supplier.email}
          </p>
          <p>{supplier.address}</p>
          <p className="small muted">{supplier.notes}</p>
          <h3 style={{ margin: "22px 0 14px" }}>Purchase history</h3>
          <Table
            headers={[
              "Order",
              "Date",
              "Total",
              "Paid",
              "Pending quantity",
              "Status",
              "Details",
            ]}
          >
            {data.purchases
              .filter((p) => p.supplierId === supplier.id)
              .map((o) => (
                <tr key={o.id}>
                  <td>{o.number}</td>
                  <td>{date(o.createdAt)}</td>
                  <td>{money(o.total)}</td>
                  <td>{money(o.paid)}</td>
                  <td>
                    {o.status === "CANCELLED"
                      ? "0"
                      : qty(
                          sum(o.items, (x) =>
                            D(x.quantity).minus(x.received).toString(),
                          ).toString(),
                        )}
                  </td>
                  <td>{o.status}</td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() =>
                        onOpen({ kind: "purchaseDetail", id: o.id })
                      }
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
          </Table>
        </>
      )}
    </Dialog>
  );
}
function SaleDetails({ sale: s }: { sale: SaleData }) {
  return (
    <>
      <div className="section-head">
        <div>
          <Tag tone={s.status === "CANCELLED" ? "bad" : ""}>{s.status}</Tag>
          <p className="muted small" style={{ marginTop: 8 }}>
            {date(s.createdAt)} · {s.customer || "Walk-in customer"}
          </p>
        </div>
        <strong>{money(s.total)}</strong>
      </div>
      <Table
        headers={[
          "Product",
          "Quantity",
          "Returned",
          "Unit price",
          "Discount",
          "Line total",
          "Historical unit cost",
        ]}
      >
        {s.items.map((x) => (
          <tr key={x.id}>
            <td>
              {x.product.name}
              {x.overrideReason && (
                <div className="small muted">Override: {x.overrideReason}</div>
              )}
            </td>
            <td>{qty(x.quantity)}</td>
            <td>{qty(x.returned)}</td>
            <td>{money(x.unitPrice)}</td>
            <td>{money(x.discount)}</td>
            <td>{money(x.total)}</td>
            <td>{money(x.unitCost)}</td>
          </tr>
        ))}
      </Table>
      <div className="detail-grid">
        <div>
          <span className="muted small">Gross sales</span>
          <strong>{money(s.gross)}</strong>
        </div>
        <div>
          <span className="muted small">Discounts</span>
          <strong>{money(s.discount)}</strong>
        </div>
        <div>
          <span className="muted small">Original estimated gross profit</span>
          <strong>{money(D(s.total).minus(s.cogs))}</strong>
        </div>
      </div>
      <p className="muted">{s.notes}</p>
      <p className="small muted">
        This is the original transaction. Date-based reports reflect refunds and
        cancellation reversals.
      </p>
    </>
  );
}
function PurchaseDetails({
  purchase: p,
  onOpen,
  admin,
}: {
  purchase: PurchaseData;
  onOpen: (m: Modal) => void;
  admin: boolean;
}) {
  return (
    <>
      <div className="section-head">
        <div>
          <Tag>{p.status.replaceAll("_", " ")}</Tag>
          <p className="muted small" style={{ marginTop: 8 }}>
            {p.supplier.name} · {date(p.createdAt)}
            {p.expectedAt ? " · Expected " + date(p.expectedAt) : ""}
          </p>
        </div>
        <div className="actions">
          {["ORDERED", "PARTIALLY_RECEIVED"].includes(p.status) && (
            <button onClick={() => onOpen({ kind: "receipt", id: p.id })}>
              <Truck size={15} />
              Receive stock
            </button>
          )}
          {admin &&
            !["DRAFT", "CANCELLED"].includes(p.status) &&
            D(p.paid).lt(p.total) && (
              <button
                className="secondary"
                onClick={() => onOpen({ kind: "payment", id: p.id })}
              >
                Record payment
              </button>
            )}
          {admin && p.status === "DRAFT" && (
            <button onClick={() => onOpen({ kind: "placeOrder", id: p.id })}>
              Place order
            </button>
          )}
          {admin && ["DRAFT", "ORDERED"].includes(p.status) && (
            <button
              className="secondary"
              onClick={() => onOpen({ kind: "cancelOrder", id: p.id })}
            >
              Cancel order
            </button>
          )}
        </div>
      </div>
      <Table
        headers={[
          "Product",
          "Ordered",
          "Received",
          "Pending",
          "Agreed cost",
          "Line total",
        ]}
      >
        {p.items.map((x) => (
          <tr key={x.id}>
            <td>{x.product.name}</td>
            <td>{qty(x.quantity)}</td>
            <td>{qty(x.received)}</td>
            <td>
              {p.status === "CANCELLED"
                ? "0"
                : qty(D(x.quantity).minus(x.received).toString())}
            </td>
            <td>{money(x.unitCost)}</td>
            <td>{money(D(x.quantity).mul(x.unitCost))}</td>
          </tr>
        ))}
      </Table>
      <div className="detail-grid">
        {[
          ["Order total", money(p.total)],
          ["Amount paid", money(p.paid)],
          ["Outstanding", money(D(p.total).minus(p.paid))],
        ].map(([k, v]) => (
          <div key={k}>
            <span className="small muted">{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <p className="muted">{p.notes}</p>
      <h3 style={{ margin: "25px 0 12px" }}>Delivery history</h3>
      {p.receipts.length ? (
        <Table headers={["Receipt", "Date", "Items", "Actual receipt cost"]}>
          {p.receipts.map((r) => (
            <tr key={r.id}>
              <td className="small">{r.id}</td>
              <td>{date(r.createdAt)}</td>
              <td>
                {r.items.map((x) => (
                  <div key={x.id}>
                    {p.items.find((i) => i.id === x.orderItemId)?.product.name}{" "}
                    × {qty(x.quantity)} @ {money(x.unitCost)}
                  </div>
                ))}
              </td>
              <td>
                {money(
                  sum(r.items, (x) => D(x.quantity).mul(x.unitCost).toString()),
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="small muted">No deliveries recorded.</p>
      )}
      <h3 style={{ margin: "25px 0 12px" }}>Payment history</h3>
      {p.payments.length ? (
        <Table headers={["Date", "Amount", "Method", "Reference"]}>
          {p.payments.map((x) => (
            <tr key={x.id}>
              <td>{date(x.createdAt)}</td>
              <td>{money(x.amount)}</td>
              <td>{x.method}</td>
              <td>{x.reference || "—"}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="small muted">No payments recorded.</p>
      )}
    </>
  );
}
