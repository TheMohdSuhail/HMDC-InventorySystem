"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FileDown, Plus, ScanLine, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  identifier,
  queueProductScan,
  MAX_IMPORT_ROWS,
  type ImportPreview,
} from "@/lib/product-import";
const Scanner = dynamic(() => import("./scanner"), { ssr: false });
const columns = [
  ["name", "Product name"],
  ["barcode", "Barcode"],
  ["sku", "SKU"],
  ["openingQuantity", "Opening quantity"],
  ["unit", "Unit"],
  ["category", "Category"],
  ["expiryDate", "Expiry date (YYYY-MM-DD)"],
  ["minStock", "Minimum stock"],
  ["notes", "Notes"],
  ["active", "Active (true/false)"],
] as const;
export default function BulkProducts({
  mode: initialMode,
  data,
  onClose,
  onSaved,
}: {
  mode: "import" | "scan";
  data: { products: { barcode: string | null }[] };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const barcodeInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState(initialMode);
  const [rows, setRowState] = useState<Record<string, string>[]>([]);
  const queueRef = useRef<Record<string, string>[]>([]);
  // Update the event-side queue synchronously so rapid scanner events cannot lose rows.
  const setRows = useCallback(
    (
      update:
        | Record<string, string>[]
        | ((current: Record<string, string>[]) => Record<string, string>[]),
    ) => {
      const next =
        typeof update === "function" ? update(queueRef.current) : update;
      queueRef.current = next;
      setRowState(next);
    },
    [],
  );
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [barcode, setBarcode] = useState("");
  const [camera, setCamera] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [fileName, setFileName] = useState("");
  const displayColumns = columns.filter(
    ([key]) =>
      !["category", "minStock", "notes", "active"].includes(key) ||
      rows.some((r) => r[key]),
  );
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  const addBarcode = useCallback(
    (value: string) => {
      const code = value.trim();
      if (!code) return;
      setBarcode("");
      barcodeInput.current?.focus();
      if (code.length > 191) {
        toast.error("Barcode is too long");
        return;
      }
      if (
        data.products.some(
          (p) => p.barcode && identifier(p.barcode) === identifier(code),
        )
      ) {
        toast.error(
          "Barcode already registered. Use Receive stock for existing products.",
        );
        return;
      }
      setPreview(null);
      setError("");
      try {
        setRows((current) => queueProductScan(current, code));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to queue scan");
      }
    },
    [data.products, setRows],
  );
  async function request(body: BodyInit, json = false) {
    const response = await fetch("/api/products/bulk", {
      method: "POST",
      headers: json ? { "Content-Type": "application/json" } : undefined,
      body,
    });
    if (response.status === 401) {
      location.assign("/login");
      throw new Error("Please log in");
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed");
    return result;
  }
  async function previewRows() {
    setBusy(true);
    setError("");
    try {
      setPreview(
        await request(JSON.stringify({ mode: "preview", rows }), true),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to preview");
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    setBusy(true);
    setPreview(null);
    setRows([]);
    setError("");
    setFileName(file.name);
    try {
      const form = new FormData();
      form.set("file", file);
      const result: ImportPreview = await request(form);
      setRows(result.rows);
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to read file");
    } finally {
      setBusy(false);
    }
  }
  function edit(index: number, key: string, value: string) {
    setPreview(null);
    setRows((current) =>
      current.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    );
  }
  return (
    <dialog
      ref={dialog}
      className="dialog native-dialog wide bulk-dialog"
      aria-label="Bulk add products"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="section-head">
        <div>
          <h2>Bulk add products</h2>
          <p className="muted small">
            Admin only · New products · Up to {MAX_IMPORT_ROWS} rows per batch
          </p>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          onClick={onClose}
          aria-label="Close bulk entry"
        >
          <X size={18} />
        </button>
      </div>
      <div className="report-tabs">
        <button
          className={mode === "import" ? "" : "secondary"}
          onClick={() => setMode("import")}
        >
          Excel import
        </button>
        <button
          className={mode === "scan" ? "" : "secondary"}
          onClick={() => setMode("scan")}
        >
          Continuous scan
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="notice">
        Save creates new catalog products and audited opening-stock movements
        together. Existing SKUs and barcodes are blocked. No existing stock is
        changed. All rows must be valid before anything is saved.
      </div>
      {mode === "import" ? (
        <>
          <div className="actions" style={{ marginBottom: 16 }}>
            <a className="export-link" href="/api/products/bulk">
              <FileDown size={15} />
              Download Excel template
            </a>
          </div>
          <label>
            Upload product file
            <input
              aria-label="Upload product file"
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                e.target.value = "";
              }}
            />
          </label>
          <p className="muted small">
            Excel .xlsx, maximum 2 MB. First sheet, values only. Keep barcode
            and SKU cells formatted as Text to preserve leading zeros. Required
            column: name. Optional openingQuantity defaults to zero.
          </p>
          {fileName && (
            <p className="small muted" style={{ marginTop: 8 }}>
              File: {fileName}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="actions" style={{ marginBottom: 16 }}>
            <label style={{ flex: 1, margin: 0 }}>
              Scan / enter barcode
              <input
                ref={barcodeInput}
                autoFocus
                aria-label="Scan / enter barcode"
                value={barcode}
                maxLength={191}
                placeholder="USB scanner: scan and press Enter"
                disabled={busy || rows.length >= MAX_IMPORT_ROWS}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBarcode(barcode);
                  }
                }}
              />
            </label>
            <button
              className="secondary"
              disabled={busy || rows.length >= MAX_IMPORT_ROWS}
              onClick={() => addBarcode(barcode)}
            >
              <Plus size={16} />
              Add scan
            </button>
            <button
              className="secondary"
              disabled={busy || rows.length >= MAX_IMPORT_ROWS}
              onClick={() => setCamera(true)}
            >
              <ScanLine size={16} />
              Camera scan
            </button>
          </div>
          <p className="muted small">
            Each scan represents one opening unit. Scan a new barcode to add a
            row; scan the same new barcode again to add one unit. Review
            quantities and product details before saving. Camera mode waits for
            “Scan next item” to prevent accidental repeated scans.
          </p>
        </>
      )}
      {rows.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 20 }}>
            <h3>{rows.length} products in batch</h3>
            <span className="small muted">
              Opening quantities can be zero or up to 3 decimal places
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  {displayColumns.map(([key, label]) => (
                    <th key={key}>{label}</th>
                  ))}
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {displayColumns.map(([key, label]) => (
                      <td key={key}>
                        <input
                          aria-label={`${label} row ${i + 1}`}
                          style={{ minWidth: key === "name" ? 170 : 110 }}
                          disabled={busy}
                          value={r[key] || ""}
                          type={
                            [
                              "purchasePrice",
                              "sellingPrice",
                              "openingQuantity",
                              "minStock",
                            ].includes(key)
                              ? "number"
                              : "text"
                          }
                          min="0"
                          step={
                            ["openingQuantity", "minStock"].includes(key)
                              ? "0.001"
                              : "0.0001"
                          }
                          maxLength={191}
                          inputMode={
                            [
                              "purchasePrice",
                              "sellingPrice",
                              "openingQuantity",
                            ].includes(key)
                              ? "decimal"
                              : undefined
                          }
                          onChange={(e) => edit(i, key, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() => {
                          setRows((current) =>
                            current.filter((_, n) => n !== i),
                          );
                          setPreview(null);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {preview && (
        <div style={{ marginTop: 20 }} role="status">
          <strong>
            {preview.validCount} of {rows.length} rows valid
          </strong>
          {preview.issues.length > 0 ? (
            <ul className="error">
              {preview.issues.map((issue, i) => (
                <li key={i}>
                  Product row {issue.row}, {issue.field}: {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <div className="notice">
              Preview passed. Confirm below to import {rows.length} new products
              and their opening stock.
            </div>
          )}
        </div>
      )}
      <div className="form-footer">
        <button className="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="secondary"
          onClick={() => void previewRows()}
          disabled={busy || !rows.length}
        >
          {busy ? "Processing…" : "Validate preview"}
        </button>
        <button
          disabled={
            busy || !preview || preview.issues.length > 0 || !rows.length
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await request(
                JSON.stringify({ mode: "commit", requestKey, rows }),
                true,
              );
              toast.success(
                `${result.count} products imported with opening stock`,
              );
              await onSaved();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Import failed");
              setPreview(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm import
        </button>
      </div>
      {camera && (
        <Scanner
          continuous
          onScan={addBarcode}
          onClose={() => {
            setCamera(false);
            barcodeInput.current?.focus();
          }}
        />
      )}
    </dialog>
  );
}
