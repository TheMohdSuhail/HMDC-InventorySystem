// Shared by browser and server: keep free of database imports.

/** Team codes are 1–10 letters, stored uppercase (e.g. TRL). */
export const TEAM_CODE = /^[A-Z]{1,10}$/;

/** Order IDs: team code, optional "-" or "/", then a number (TRL1023, TRL-1023). */
const ORDER_ID = /^([A-Z]{1,10})[-/]?(\d[A-Z0-9/-]{0,49})$/;

export function normalizeTeamCode(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeOrderNo(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/** Returns the team code prefix of an order ID, or null if the format is wrong. */
export function orderPrefix(orderNo: string) {
  const match = ORDER_ID.exec(normalizeOrderNo(orderNo));
  return match ? match[1] : null;
}

/** Suggests a code from a name's initials: "Tanveer Rashid Lone" → "TRL", "Aman Khan" → "AMK". */
export function suggestTeamCode(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z\s]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0]).join("");
  if (words.length === 2) return words[0].slice(0, 2) + words[1][0];
  return words[0].slice(0, 3);
}

export const ORDER_STATUSES = [
  "PLACED",
  "DISPATCHED",
  "DELIVERED",
  "RETURNED",
  "DAMAGED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/** Statuses where the order's products are out of stock (sold). */
export const OPEN_STATUSES: readonly string[] = ["PLACED", "DISPATCHED", "DELIVERED"];
export const STATUS_LABELS: Record<OrderStatus, string> = {
  PLACED: "Placed",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  RETURNED: "Returned",
  DAMAGED: "Damaged",
  CANCELLED: "Cancelled",
};

/**
 * Where an order's products sit for a status: null while sold (open statuses),
 * back in sellable stock (Returned, Cancelled), or in damaged stock (Damaged).
 */
export function statusBucket(status: string): "SELLABLE" | "DAMAGED" | null {
  if (OPEN_STATUSES.includes(status)) return null;
  return status === "DAMAGED" ? "DAMAGED" : "SELLABLE";
}

/** Short note on what a status change does to stock, for confirmations. */
export function stockNote(from: string, to: string) {
  const bucket = statusBucket(to);
  if (statusBucket(from) === bucket) return "";
  if (bucket === "DAMAGED") return " — moved to damaged stock";
  return bucket ? " — stock returned" : " — stock taken again";
}
