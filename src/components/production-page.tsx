"use client";
import { useState, type ReactNode } from "react";
import { PackageCheck, PackagePlus, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, fmt, when, type Data } from "./sales-page";

type Event = Data["events"][number];
/** Manufacturing operations the main app can open in its batch form. */
export type ProductionMode = "READY" | "DISPATCH" | "RECEIVE" | "MFG_RETURN";

export const CONDITION_LABELS: Record<string, string> = {
  SELLABLE: "Good stock",
  DAMAGED: "Damaged",
  EXPIRED: "Expired",
  QUARANTINED: "On hold / other",
};
const TYPE_LABELS: Record<string, string> = {
  READY: "Finished stock recorded",
  DISPATCH: "Sent to warehouse",
  RECEIVE: "Received at warehouse",
  MFG_RETURN: "Sent to manufacturer",
};
const pending = (e: Event) =>
  e.items.filter((i) => Number(i.quantity) > Number(i.processed));

/**
 * Manufacturing in one place. Manufacturers record finished stock and send it;
 * admin receives it, and can send good, damaged, expired or held stock back.
 */
export default function ProductionPage({
  data,
  saved,
  operate,
  addProduct,
}: {
  data: Data;
  saved: () => Promise<void> | void;
  operate: (mode: ProductionMode, preset?: { sourceId?: string }) => void;
  addProduct: () => void;
}) {
  const manufacturer = data.user.role === "MANUFACTURER";
  const [busy, setBusy] = useState("");
  const [shown, setShown] = useState(20);
  const name = (id: string) =>
    data.products.find((p) => p.id === id)?.name || id;
  const who = (id: string) =>
    data.users.find((u) => u.id === id)?.email || "Manufacturer";
  const lines = (e: Event, onlyPending = false) =>
    (onlyPending ? pending(e) : e.items).map((i) => (
      <div key={i.id}>
        {name(i.productId)}:{" "}
        <strong>
          {fmt(onlyPending ? Number(i.quantity) - Number(i.processed) : i.quantity)}
        </strong>
        {!onlyPending && e.type === "DISPATCH" && (
          <span className="small muted"> · {fmt(i.processed)} received</span>
        )}
      </div>
    ));
  const returns = data.events.filter((e) => e.type === "MFG_RETURN");

  if (manufacturer)
    return (
      <>
        <section className="panel">
          <h2>Your work</h2>
          <ol className="production-steps small muted">
            <li>Record finished stock when a batch is ready.</li>
            <li>Send stock to the warehouse when it leaves your factory.</li>
            <li>The warehouse confirms what it received.</li>
          </ol>
          <div className="actions quantity-actions">
            <button onClick={() => operate("READY")}>
              <PackagePlus size={16} /> Record finished stock
            </button>
            <button onClick={() => operate("DISPATCH")}>
              <Send size={16} /> Send stock to warehouse
            </button>
            <button className="secondary" onClick={addProduct}>
              Enter new product details
            </button>
          </div>
        </section>
        <section className="panel">
          <h2>Stock sent to you by the warehouse</h2>
          <ReturnsTable events={returns} lines={lines} />
        </section>
      </>
    );

  const waiting = data.events.filter(
    (e) => e.type === "DISPATCH" && pending(e).length,
  );
  const makers = data.users.filter((u) => u.role === "MANUFACTURER");
  const ready = makers.flatMap((u) =>
    data.balances
      .filter((b) => b.ownerId === u.id && Number(b.quantity) > 0)
      .map((b) => ({ maker: u.email, ...b })),
  );
  const history = data.events.filter((e) => e.type in TYPE_LABELS);

  /** Receives everything still pending on a dispatch in one step. */
  async function receiveAll(e: Event) {
    const items = pending(e).map((i) => ({
      productId: i.productId,
      quantity: String(Number(i.quantity) - Number(i.processed)),
    }));
    const total = items.reduce((n, i) => n + Number(i.quantity), 0);
    if (
      !confirm(
        `Receive all ${fmt(total)} pieces from ${who(e.ownerId)} into the warehouse?`,
      )
    )
      return;
    setBusy(e.id);
    try {
      await api("POST", "/api/quantity", {
        type: "RECEIVE",
        requestKey: crypto.randomUUID(),
        ownerId: "CENTRAL",
        sourceId: e.id,
        notes: "Received full manufacturer delivery",
        items,
      });
      toast.success(`Received ${fmt(total)} pieces into the warehouse`);
      await saved();
    } catch (err) {
      toast.error((err as Error).message, { duration: 8000 });
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="actions quantity-actions">
        <button onClick={() => operate("RECEIVE")}>
          <PackageCheck size={16} /> Receive stock from manufacturer
        </button>
        <button className="secondary" onClick={() => operate("MFG_RETURN")}>
          <Undo2 size={16} /> Send stock to manufacturer
        </button>
      </div>
      {!makers.length && (
        <p className="error" role="alert">
          No manufacturer account yet. Add one under Settings to start production.
        </p>
      )}

      <section className="panel">
        <div className="section-head">
          <h2>Waiting to be received</h2>
          <span className="tag">{waiting.length} delivery(ies)</span>
        </div>
        {!waiting.length ? (
          <p className="empty">Nothing is on the way from manufacturers.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sent on</th>
                  <th>Manufacturer</th>
                  <th>Still to receive</th>
                  <th>Receive</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((e) => (
                  <tr key={e.id}>
                    <td>{when(e.createdAt)}</td>
                    <td>{who(e.ownerId)}</td>
                    <td>{lines(e, true)}</td>
                    <td>
                      <div className="actions">
                        <button
                          disabled={busy === e.id}
                          onClick={() => void receiveAll(e)}
                        >
                          {busy === e.id ? "Receiving…" : "Receive all"}
                        </button>
                        <button
                          className="secondary"
                          disabled={busy === e.id}
                          title="Receive only some of the pieces"
                          onClick={() => operate("RECEIVE", { sourceId: e.id })}
                        >
                          Receive part
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Ready at manufacturers</h2>
        <p className="small muted">
          Finished stock a manufacturer has recorded but not yet sent.
        </p>
        {!ready.length ? (
          <p className="empty">No finished stock is waiting at manufacturers.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Manufacturer</th>
                  <th>Product</th>
                  <th>Ready pieces</th>
                </tr>
              </thead>
              <tbody>
                {ready.map((b) => (
                  <tr key={`${b.ownerId}|${b.productId}`}>
                    <td>{b.maker}</td>
                    <td>{name(b.productId)}</td>
                    <td>{fmt(b.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Production history</h2>
        {!history.length ? (
          <p className="empty">No production activity yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What happened</th>
                  <th>Manufacturer</th>
                  <th>Products / pieces</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, shown).map((e) => (
                  <tr key={e.id}>
                    <td>{when(e.createdAt)}</td>
                    <td>
                      {TYPE_LABELS[e.type]}
                      {e.type === "MFG_RETURN" && (
                        <div className="small muted">
                          {CONDITION_LABELS[e.condition] ?? e.condition}
                        </div>
                      )}
                    </td>
                    <td>
                      {e.type === "RECEIVE"
                        ? who(
                            data.events.find((s) => s.id === e.sourceId)?.ownerId ??
                              "",
                          )
                        : who(e.ownerId)}
                    </td>
                    <td>{lines(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.length > shown && (
              <button className="secondary" onClick={() => setShown(shown + 50)}>
                Show more ({shown} of {history.length})
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function ReturnsTable({
  events,
  lines,
}: {
  events: Event[];
  lines: (e: Event) => ReactNode;
}) {
  if (!events.length)
    return <p className="empty">The warehouse has not sent you any stock.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Stock type</th>
            <th>Products / pieces</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{when(e.createdAt)}</td>
              <td>{CONDITION_LABELS[e.condition] ?? e.condition}</td>
              <td>{lines(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
