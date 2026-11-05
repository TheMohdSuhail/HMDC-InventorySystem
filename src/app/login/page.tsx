"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Leaf, ArrowRight, ShieldCheck } from "lucide-react";
export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <main className="login">
      <div className="login-intro">
        <div className="brand">
          <span className="brand-icon">
            <Leaf />
          </span>{" "}
          HERBAL MAZA
        </div>
        <h1>
          A little clarity.
          <br />A lot more control.
        </h1>
        <p>
          Your products, purchases, and daily sales.
          <br />
          One calm place to keep everything in order.
        </p>
        <span className="eyebrow">PERSONAL INVENTORY WORKSPACE</span>
      </div>
      <section className="panel login-card">
        <ShieldCheck className="accent" size={32} />
        <h2>Welcome back</h2>
        <p className="muted">Sign in to your inventory workspace.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const fd = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.fromEntries(fd)),
              });
              const data = await r.json();
              if (!r.ok) throw new Error(data.error);
              router.replace("/");
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Login failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email address
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy} className="full">
            {busy ? "Signing in…" : "Sign in"} <ArrowRight size={17} />
          </button>
        </form>
        <p className="small muted">
          Private access only. Initial setup is performed from the server
          command line.
        </p>
      </section>
    </main>
  );
}
