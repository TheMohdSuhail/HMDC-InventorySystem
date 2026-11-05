"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
type Role = "ADMIN" | "BRANCH_MANAGER" | "MANUFACTURER";
type User = { id: string; email: string; role: Role; active: boolean };

const roleLabels: Record<Role, string> = {
  ADMIN: "Admin",
  BRANCH_MANAGER: "Branch manager",
  MANUFACTURER: "Manufacturer",
};

export default function Accounts({ admin }: { admin: boolean }) {
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!admin) return;
    try {
      const r = await fetch("/api/users");
      if (!r.ok) throw new Error("Unable to load accounts");
      setUsers(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load accounts");
    }
  }, [admin]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      {admin && (
        <section className="panel">
          <div className="section-head">
            <h2>Account management</h2>
            <span className="tag">Admin only</span>
          </div>
          <p className="small muted">
            Admin manages all inventory and accounts. Branch managers record
            sales, returns and losses only against assigned stock. Manufacturers
            record ready stock and dispatches. Account changes revoke sessions.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="table-wrap" style={{ margin: "20px 0" }}>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Access</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{roleLabels[u.role]}</td>
                    <td>{u.active ? "Active" : "Disabled"}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setSelected(u)}
                      >
                        Edit account or set new password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ marginBottom: 20 }}>
            {selected ? "Edit account" : "Create account"}
          </h3>
          <form
            key={selected?.id || "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = e.currentTarget;
              const fd = new FormData(f);
              try {
                const r = await fetch("/api/users", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: selected?.id,
                    email: fd.get("email"),
                    role: fd.get("role"),
                    active: fd.get("active") === "on",
                    ...(fd.get("password")
                      ? { password: fd.get("password") }
                      : {}),
                  }),
                });
                const result = await r.json();
                if (!r.ok) throw new Error(result.error);
                toast.success("Account saved");
                setSelected(null);
                f.reset();
                await load();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Unable to save account",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Email
                <input
                  name="email"
                  required
                  type="email"
                  maxLength={191}
                  defaultValue={selected?.email}
                />
              </label>
              <label>
                Access level
                <select
                  name="role"
                  defaultValue={selected?.role || "BRANCH_MANAGER"}
                >
                  <option value="ADMIN">Admin — full access</option>
                  <option value="BRANCH_MANAGER">
                    Branch manager — branch stock
                  </option>
                  <option value="MANUFACTURER">
                    Manufacturer — production and deliveries
                  </option>
                </select>
              </label>
              <label>
                {selected
                  ? "New password (leave blank to keep current)"
                  : "Initial password"}
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required={!selected}
                  minLength={16}
                  maxLength={72}
                />
              </label>
              <label className="check-label">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={selected?.active ?? true}
                />
                Active account
              </label>
            </div>
            <div className="actions">
              <button disabled={busy}>
                {busy
                  ? "Saving…"
                  : selected
                    ? "Save changes (user will be signed out)"
                    : "Create account"}
              </button>
              {selected && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelected(null)}
                >
                  Cancel account edit
                </button>
              )}
            </div>
          </form>
        </section>
      )}
      <section className="panel" style={{ maxWidth: 760 }}>
        <h2>Change your password</h2>
        <p className="small muted" style={{ margin: "8px 0 22px" }}>
          Use at least 16 characters, up to 72 bytes. Changing your password
          signs out all your sessions.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const fd = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.fromEntries(fd)),
              });
              const result = await r.json();
              if (!r.ok) throw new Error(result.error);
              location.assign("/login");
            } catch (e) {
              toast.error(
                e instanceof Error ? e.message : "Unable to change password",
              );
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              New password
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={16}
                maxLength={72}
              />
            </label>
          </div>
          <button disabled={busy}>Change password and sign out</button>
        </form>
      </section>
    </>
  );
}
