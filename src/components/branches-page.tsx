"use client";
import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  Plus,
  Search,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import type { Prisma } from "@prisma/client";
import type { Workspace } from "@/lib/workspace";
import { PasswordInput } from "./password-input";
import { Dialog } from "./sales-page";

type Json<T> = T extends Date
  ? string
  : T extends Prisma.Decimal
    ? string
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
type Data = Json<Workspace>;
type Branch = Data["users"][number];

const fmt = (v: unknown) =>
  Number(String(v ?? 0)).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const when = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function BranchesPage({
  data,
  saved,
  operate,
}: {
  data: Data;
  saved: () => Promise<void>;
  operate: (mode: "ASSIGN" | "BRANCH_RETURN", ownerId?: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const minStock = Number(data.settings.minStock);

  const products = useMemo(
    () => new Map(data.products.map((p) => [p.id, p])),
    [data.products],
  );
  const branches = useMemo(
    () =>
      data.users
        .filter((u) => u.role === "BRANCH_MANAGER")
        .map((u) => {
          const lines = data.balances
            .filter((b) => b.ownerId === u.id)
            .map((b) => ({ ...b, product: products.get(b.productId) }))
            .filter(
              (b) =>
                Number(b.quantity) ||
                Number(b.damaged) ||
                Number(b.expired) ||
                Number(b.quarantined),
            )
            .sort((a, b) =>
              (a.product?.name || "").localeCompare(b.product?.name || ""),
            );
          const sum = (k: "quantity" | "damaged" | "expired" | "quarantined") =>
            lines.reduce((n, l) => n + Number(l[k]), 0);
          const last = data.events.find((e) => e.ownerId === u.id);
          return {
            user: u,
            lines,
            pieces: sum("quantity"),
            unusable: sum("damaged") + sum("expired") + sum("quarantined"),
            low: lines.filter((l) => Number(l.quantity) <= minStock).length,
            last: last?.createdAt,
          };
        }),
    [data.users, data.balances, data.events, products, minStock],
  );

  const q = search.trim().toLowerCase();
  const visible = branches
    .filter((b) => showDisabled || b.user.active)
    .map((b) => {
      if (!q || b.user.email.toLowerCase().includes(q)) return b;
      const lines = b.lines.filter((l) =>
        [l.product?.name, l.product?.sku, l.product?.barcode].some((v) =>
          v?.toLowerCase().includes(q),
        ),
      );
      return lines.length ? { ...b, lines } : null;
    })
    .filter((b): b is (typeof branches)[number] => !!b);

  const active = branches.filter((b) => b.user.active);
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="actions quantity-actions">
        <button onClick={() => setEditing("new")}>
          <Plus size={16} /> Add new branch
        </button>
        <button className="secondary" onClick={() => operate("ASSIGN")}>
          <ArrowUpFromLine size={16} /> Send stock to branch
        </button>
        <button className="secondary" onClick={() => operate("BRANCH_RETURN")}>
          <ArrowDownToLine size={16} /> Return branch stock to warehouse
        </button>
      </div>

      <div className="quantity-cards">
        {[
          ["Active branches", String(active.length)],
          ["Pieces at branches", fmt(active.reduce((n, b) => n + b.pieces, 0))],
          [
            "Damaged / expired / on hold",
            fmt(active.reduce((n, b) => n + b.unusable, 0)),
          ],
          [
            "Low stock lines",
            String(active.reduce((n, b) => n + b.low, 0)),
          ],
        ].map(([label, value]) => (
          <section className="panel" key={label}>
            <p className="muted small">{label}</p>
            <strong className="quantity-number">{value}</strong>
          </section>
        ))}
      </div>

      <section className="panel">
        <div className="branch-toolbar">
          <label className="branch-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="Search branch email or product"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search branches or products"
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={showDisabled}
              onChange={(e) => setShowDisabled(e.target.checked)}
            />
            Show disabled branches
          </label>
        </div>

        {!visible.length && (
          <p className="empty">
            {branches.length
              ? "No branch matches this search."
              : "No branches yet. Use “Add new branch” to create one."}
          </p>
        )}

        <div className="branch-list">
          {visible.map((b) => {
            const expanded = open.has(b.user.id) || !!q;
            return (
              <article
                key={b.user.id}
                className={`branch-card${b.user.active ? "" : " disabled"}`}
              >
                <div className="branch-head">
                  <div className="branch-title">
                    <span className="brand-icon" aria-hidden>
                      <Store size={18} />
                    </span>
                    <div>
                      <strong>{b.user.email}</strong>
                      <div className="small muted">
                        <span className={`tag${b.user.active ? "" : " bad"}`}>
                          {b.user.active ? "Active" : "Disabled"}
                        </span>{" "}
                        {b.last ? `Last activity ${when(b.last)}` : "No activity yet"}
                      </div>
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={!b.user.active}
                      onClick={() => operate("ASSIGN", b.user.id)}
                    >
                      <ArrowUpFromLine size={15} /> Send stock
                    </button>
                    <button
                      className="secondary"
                      disabled={!b.pieces}
                      onClick={() => operate("BRANCH_RETURN", b.user.id)}
                    >
                      <ArrowDownToLine size={15} /> Return stock
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setEditing(b.user)}
                    >
                      <Pencil size={15} /> Edit branch
                    </button>
                  </div>
                </div>

                <div className="branch-stats">
                  <div>
                    <span className="small muted">Products</span>
                    <strong>{b.lines.length}</strong>
                  </div>
                  <div>
                    <span className="small muted">Available pieces</span>
                    <strong>{fmt(b.pieces)}</strong>
                  </div>
                  <div>
                    <span className="small muted">Damaged / expired / hold</span>
                    <strong>{fmt(b.unusable)}</strong>
                  </div>
                  <div>
                    <span className="small muted">Low stock</span>
                    <strong className={b.low ? "error" : ""}>{b.low}</strong>
                  </div>
                </div>

                {b.lines.length > 0 && (
                  <button
                    type="button"
                    className="link-button"
                    aria-expanded={expanded}
                    onClick={() => toggle(b.user.id)}
                  >
                    {expanded ? "Hide stock" : `Show stock (${b.lines.length} products)`}
                  </button>
                )}
                {expanded && b.lines.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Available</th>
                          <th>Damaged</th>
                          <th>Expired</th>
                          <th>On hold</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.lines.map((l) => {
                          const qty = Number(l.quantity);
                          return (
                            <tr key={l.productId}>
                              <td>
                                <strong>{l.product?.name || l.productId}</strong>
                                <div className="small muted">
                                  {l.product?.barcode || l.product?.sku || ""}
                                </div>
                              </td>
                              <td>{fmt(l.quantity)}</td>
                              <td>{fmt(l.damaged)}</td>
                              <td>{fmt(l.expired)}</td>
                              <td>{fmt(l.quarantined)}</td>
                              <td>
                                {qty <= 0 ? (
                                  <span className="tag bad">Out</span>
                                ) : qty <= minStock ? (
                                  <span className="tag warning">Low</span>
                                ) : (
                                  <span className="tag">OK</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {editing && (
        <BranchForm
          branch={editing === "new" ? null : editing}
          hasStock={
            editing !== "new" &&
            !!branches.find(
              (b) => b.user.id === editing.id && (b.pieces || b.unusable),
            )
          }
          close={() => setEditing(null)}
          saved={saved}
        />
      )}
    </>
  );
}

function BranchForm({
  branch,
  hasStock,
  close,
  saved,
}: {
  branch: Branch | null;
  hasStock: boolean;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title={branch ? `Edit branch ${branch.email}` : "Add new branch"}
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="small muted" style={{ marginBottom: 16 }}>
        A branch is a branch-manager login. They see only the stock sent to
        them and record sales, returns and losses for it.
        {branch && " Saving changes signs this branch out."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const active = fd.get("active") === "on";
          if (branch && !active && hasStock) {
            if (
              !confirm(
                "This branch still has stock. Disabling it stops them signing in, but the stock stays with the branch. Continue?",
              )
            )
              return;
          }
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: branch?.id,
                email: fd.get("email"),
                role: "BRANCH_MANAGER",
                active,
                ...(fd.get("password") ? { password: fd.get("password") } : {}),
              }),
            });
            if (r.status === 401) location.assign("/login");
            const result = await r.json();
            if (!r.ok) throw new Error(result.error || "Unable to save branch");
            await saved();
            toast.success(branch ? "Branch updated" : "Branch created");
            close();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Branch login email
            <input
              name="email"
              type="email"
              required
              maxLength={191}
              defaultValue={branch?.email}
            />
          </label>
          <label>
            {branch ? "New password (leave blank to keep)" : "Password"}
            <PasswordInput
              name="password"
              autoComplete="new-password"
              required={!branch}
              maxLength={72}
            />
          </label>
          <label className="check-label">
            <input
              name="active"
              type="checkbox"
              defaultChecked={branch?.active ?? true}
            />
            Active (can sign in)
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button disabled={busy}>
            {busy ? "Saving…" : branch ? "Save branch" : "Create branch"}
          </button>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
