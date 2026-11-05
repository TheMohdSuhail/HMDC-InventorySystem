"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { X } from "lucide-react";
export default function Scanner({
  onScan,
  onClose,
  continuous = false,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
  continuous?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const armed = useRef(true);
  const scanHandler = useRef(onScan);
  useEffect(() => {
    scanHandler.current = onScan;
  }, [onScan]);
  const [lastScan, setLastScan] = useState("");
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  useEffect(() => {
    let controls: IScannerControls | undefined;
    let disposed = false;
    armed.current = true;
    if (!window.isSecureContext) {
      setError("Camera scanning requires HTTPS. Use manual entry below.");
      return;
    }
    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        video.current!,
        (result, _, c) => {
          if (result && !disposed && armed.current) {
            armed.current = false;
            if (!continuous) c.stop();
            setLastScan(result.getText());
            scanHandler.current(result.getText());
          }
        },
      )
      .then((c) => {
        controls = c;
        if (disposed) c.stop();
      })
      .catch(() => {
        if (!disposed)
          setError(
            "Camera unavailable or permission denied. Enter the barcode below.",
          );
      });
    return () => {
      disposed = true;
      controls?.stop();
    };
  }, [continuous]);
  return (
    <dialog
      ref={dialog}
      className="dialog native-dialog"
      aria-labelledby="scanner-title"
      onCancel={onClose}
    >
      <div className="section-head">
        <h2 id="scanner-title">Scan a barcode</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close scanner"
        >
          <X />
        </button>
      </div>
      <video ref={video} className="scanner" muted playsInline />
      {continuous && lastScan && (
        <div className="notice">
          Scanned: {lastScan}{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              armed.current = true;
              setLastScan("");
            }}
          >
            Scan next item
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="muted small">
        Point your camera at an EAN, UPC, or Code 128 barcode.
      </p>
      <div>
        <label>
          Barcode
          <input
            autoFocus
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (manual.trim()) {
                  onScan(manual.trim());
                  setManual("");
                }
              }
            }}
            placeholder="Scan with USB scanner or type barcode"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (manual.trim()) {
              onScan(manual.trim());
              setManual("");
            }
          }}
        >
          Look up product
        </button>
      </div>
    </dialog>
  );
}
