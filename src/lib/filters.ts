import { D } from "./math";

export type InventoryFilters = {
  search: string;
  category: string;
  stock: "all" | "in" | "low" | "out";
  expiry: "all" | "expired" | "30" | "60" | "90" | "custom" | "unset";
  from: string;
  to: string;
  active: "all" | "active" | "archived";
};

export const defaultInventoryFilters: InventoryFilters = {
  search: "",
  category: "",
  stock: "all",
  expiry: "all",
  from: "",
  to: "",
  active: "all",
};

export function indiaBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
}

export function expiryRangeError(filters: InventoryFilters): string | null {
  if (filters.expiry !== "custom") return null;
  if (!filters.from || !filters.to)
    return "Choose both a start and end date. Previous results are shown.";
  if (!validDate(filters.from) || !validDate(filters.to))
    return "Enter valid dates. Previous results are shown.";
  if (filters.from > filters.to)
    return "Start date must be on or before end date. Previous results are shown.";
  return null;
}

export function matchesExpiry(
  expiry: string | null,
  filters: InventoryFilters,
  today: string,
): boolean {
  if (filters.expiry === "all") return true;
  if (filters.expiry === "unset") return !expiry;
  if (!expiry) return false;
  const date = expiry.slice(0, 10);
  if (filters.expiry === "expired") return date < today;
  if (filters.expiry === "custom")
    return (
      !expiryRangeError(filters) && date >= filters.from && date <= filters.to
    );
  return (
    date >= today && date <= addCalendarDays(today, Number(filters.expiry))
  );
}

type FilterProduct = {
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  stock?: string;
  minStock?: string | null;
  expiryDate: string | null;
  active: boolean;
};

export function filterInventory<T extends FilterProduct>(
  products: readonly T[],
  filters: InventoryFilters,
  defaultMinimum: string,
  today: string,
): T[] {
  return products.filter((p) => {
    if (
      ![p.name, p.sku, p.barcode, p.category].some((value) =>
        value?.toLowerCase().includes(filters.search.toLowerCase()),
      )
    )
      return false;
    if (filters.category && p.category !== filters.category) return false;
    if (filters.active !== "all" && p.active !== (filters.active === "active"))
      return false;
    const quantity = D(p.stock ?? "0");
    if (filters.stock === "in" && !quantity.gt(0)) return false;
    if (
      filters.stock === "low" &&
      !(quantity.gt(0) && quantity.lte(p.minStock ?? defaultMinimum))
    )
      return false;
    if (filters.stock === "out" && !quantity.isZero()) return false;
    return matchesExpiry(p.expiryDate, filters, today);
  });
}

export type InventoryFilterState = {
  filters: InventoryFilters;
  appliedFilters: InventoryFilters;
  visibleCount: number;
};
export const initialInventoryFilterState: InventoryFilterState = {
  filters: defaultInventoryFilters,
  appliedFilters: defaultInventoryFilters,
  visibleCount: 50,
};
export function inventoryFilterReducer(
  state: InventoryFilterState,
  action:
    | { type: "change"; patch: Partial<InventoryFilters> }
    | { type: "clear" }
    | { type: "more" },
): InventoryFilterState {
  if (action.type === "clear") return initialInventoryFilterState;
  if (action.type === "more")
    return { ...state, visibleCount: state.visibleCount + 50 };
  const filters = { ...state.filters, ...action.patch };
  return {
    filters,
    appliedFilters: expiryRangeError(filters) ? state.appliedFilters : filters,
    visibleCount: 50,
  };
}
