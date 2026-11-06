"use client";

import { useId, useState, type ReactNode } from "react";
import { X, SlidersHorizontal } from "lucide-react";
import styles from "./filter-bar.module.css";

type Chip = { id: string; label: string; remove: () => void };

export default function FilterBar({
  search,
  onSearch,
  searchAction,
  chips,
  clear,
  count,
  total,
  error,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchAction?: ReactNode;
  chips: Chip[];
  clear: () => void;
  count: number;
  total: number;
  error?: string | null;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  return (
    <div className={styles.bar}>
      <div className={styles.search}>
        <input
          aria-label="Search inventory or scan barcode"
          placeholder="Search name, SKU or scan barcode + Enter"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.select();
          }}
        />
        {searchAction}
      </div>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={`secondary ${styles.toggle}`}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
        >
          <SlidersHorizontal size={16} /> Filters ({chips.length})
        </button>
        <p className="muted small" role="status">
          {count} of {total} products
        </p>
        <button
          type="button"
          className="secondary"
          onClick={clear}
          disabled={!chips.length}
        >
          Clear filters
        </button>
      </div>
      <div
        id={panelId}
        className={`${styles.fields} ${expanded ? styles.expanded : ""}`}
      >
        {children}
      </div>
      {error && (
        <p role="alert" className="error small">
          {error}
        </p>
      )}
      {chips.length > 0 && (
        <div className={styles.chips} aria-label="Active inventory filters">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`secondary ${styles.chip}`}
              onClick={chip.remove}
              aria-label={`Remove filter: ${chip.label}`}
            >
              <span>{chip.label}</span>
              <X size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
