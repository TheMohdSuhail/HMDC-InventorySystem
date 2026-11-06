import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  defaultInventoryFilters,
  expiryRangeError,
  filterInventory,
  indiaBusinessDate,
  initialInventoryFilterState,
  inventoryFilterReducer,
  matchesExpiry,
  type InventoryFilters,
} from "../src/lib/filters";

const today = "2026-11-06";
const filters = (patch: Partial<InventoryFilters> = {}): InventoryFilters => ({
  ...defaultInventoryFilters,
  ...patch,
});
const product = (patch = {}) => ({
  name: "Herbal syrup",
  sku: "HM-1",
  barcode: "00123",
  category: "Syrups",
  stock: "5",
  minStock: "5",
  expiryDate: today as string | null,
  active: true,
  ...patch,
});

describe("India business dates and expiry", () => {
  it("uses the next India date when UTC is still the previous date", () => {
    expect(indiaBusinessDate(new Date("2026-11-05T19:00:00Z"))).toBe(today);
    expect(indiaBusinessDate(new Date("2026-11-05T18:29:59Z"))).toBe(
      "2026-11-05",
    );
    expect(indiaBusinessDate(new Date("2026-11-05T18:30:00Z"))).toBe(today);
  });
  it("adds calendar days through month/year and leap-day boundaries", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("expires strictly before today and keeps the printed date valid", () => {
    expect(
      matchesExpiry("2026-11-05", filters({ expiry: "expired" }), today),
    ).toBe(true);
    expect(matchesExpiry(today, filters({ expiry: "expired" }), today)).toBe(
      false,
    );
  });
  it.each(["30", "60", "90"] as const)(
    "includes today and day %s, excludes the next day and yesterday",
    (preset) => {
      const f = filters({ expiry: preset });
      expect(matchesExpiry(today, f, today)).toBe(true);
      expect(
        matchesExpiry(addCalendarDays(today, Number(preset)), f, today),
      ).toBe(true);
      expect(
        matchesExpiry(addCalendarDays(today, Number(preset) + 1), f, today),
      ).toBe(false);
      expect(matchesExpiry("2026-11-05", f, today)).toBe(false);
      expect(matchesExpiry(`${today}T00:00:00.000Z`, f, today)).toBe(true);
    },
  );
  it("handles missing expiry explicitly", () => {
    for (const expiry of ["expired", "30", "60", "90", "custom"] as const)
      expect(
        matchesExpiry(null, filters({ expiry, from: today, to: today }), today),
      ).toBe(false);
    expect(matchesExpiry(null, filters({ expiry: "unset" }), today)).toBe(true);
    expect(matchesExpiry(today, filters({ expiry: "unset" }), today)).toBe(
      false,
    );
    expect(matchesExpiry(null, filters(), today)).toBe(true);
  });
  it("includes both custom boundaries and supports a single date", () => {
    const f = filters({
      expiry: "custom",
      from: "2026-11-10",
      to: "2026-11-12",
    });
    for (const date of ["2026-11-10", "2026-11-11", "2026-11-12"])
      expect(matchesExpiry(date, f, today)).toBe(true);
    expect(matchesExpiry("2026-11-09", f, today)).toBe(false);
    expect(matchesExpiry("2026-11-13", f, today)).toBe(false);
    expect(
      matchesExpiry(
        today,
        filters({ expiry: "custom", from: today, to: today }),
        today,
      ),
    ).toBe(true);
  });
  it("rejects incomplete, impossible and reversed ranges", () => {
    expect(expiryRangeError(filters({ expiry: "custom" }))).toMatch(/both/);
    expect(
      expiryRangeError(
        filters({ expiry: "custom", from: "2026-02-30", to: today }),
      ),
    ).toMatch(/valid/);
    const reversed = filters({
      expiry: "custom",
      from: "2026-11-12",
      to: "2026-11-10",
    });
    expect(expiryRangeError(reversed)).toMatch(/Start date/);
    expect(matchesExpiry(today, reversed, today)).toBe(false);
  });
});

describe("inventory filtering", () => {
  it("preserves default ordering, archived products, zero stock and undated products", () => {
    const products = [
      product(),
      product({ active: false, stock: "0", expiryDate: null }),
    ];
    expect(filterInventory(products, filters(), "5", today)).toEqual(products);
  });
  it("searches name, SKU, barcode and category case-insensitively", () => {
    for (const search of ["HERBAL", "hm-1", "00123", "SYRUPS"])
      expect(
        filterInventory([product()], filters({ search }), "5", today),
      ).toHaveLength(1);
  });
  it("in-stock includes low stock; low is positive and includes the threshold; out is exactly zero", () => {
    const products = [
      product({ stock: "0" }),
      product({ stock: "0.001" }),
      product({ stock: "5" }),
      product({ stock: "5.001" }),
    ];
    expect(
      filterInventory(products, filters({ stock: "in" }), "5", today),
    ).toHaveLength(3);
    expect(
      filterInventory(products, filters({ stock: "low" }), "5", today).map(
        (p) => p.stock,
      ),
    ).toEqual(["0.001", "5"]);
    expect(
      filterInventory(products, filters({ stock: "out" }), "5", today).map(
        (p) => p.stock,
      ),
    ).toEqual(["0"]);
  });
  it("uses a product threshold before the default, including a zero threshold", () => {
    expect(
      filterInventory(
        [product({ minStock: undefined, stock: "6" })],
        filters({ stock: "low" }),
        "7",
        today,
      ),
    ).toHaveLength(1);
    expect(
      filterInventory(
        [product({ minStock: "0", stock: "1" })],
        filters({ stock: "low" }),
        "7",
        today,
      ),
    ).toHaveLength(0);
  });
  it("combines category, stock, expiry and active filters", () => {
    const products = [
      product(),
      product({ category: "Tablets" }),
      product({ stock: "10" }),
      product({ expiryDate: "2027-01-01" }),
      product({ active: false }),
    ];
    expect(
      filterInventory(
        products,
        filters({
          category: "Syrups",
          stock: "low",
          expiry: "30",
          active: "active",
        }),
        "5",
        today,
      ),
    ).toEqual([products[0]]);
    expect(
      filterInventory(products, filters({ active: "archived" }), "5", today),
    ).toEqual([products[4]]);
  });
  it("includes zero-stock medicines in expiry-only filters", () => {
    expect(
      filterInventory(
        [product({ stock: "0" })],
        filters({ expiry: "30" }),
        "5",
        today,
      ),
    ).toHaveLength(1);
  });
});

describe("filter state and pagination", () => {
  it("filters the full dataset before taking the first page", () => {
    const products = Array.from({ length: 120 }, (_, i) =>
      product({
        category: i < 60 ? "Tablets" : "Syrups",
        name: `Medicine ${i}`,
      }),
    );
    const matched = filterInventory(
      products,
      filters({ category: "Syrups" }),
      "5",
      today,
    );
    expect(matched).toHaveLength(60);
    expect(matched.slice(0, 50)).toHaveLength(50);
    expect(matched[0].name).toBe("Medicine 60");
  });
  it("resets to 50 on every filter/search change and clear, and adds 50 on more", () => {
    const more = inventoryFilterReducer(initialInventoryFilterState, {
      type: "more",
    });
    expect(more.visibleCount).toBe(100);
    for (const patch of [
      { search: "herb" },
      { category: "Syrups" },
      { stock: "low" as const },
      { expiry: "30" as const },
      { active: "archived" as const },
      { from: today },
      { to: today },
    ])
      expect(
        inventoryFilterReducer(more, { type: "change", patch }).visibleCount,
      ).toBe(50);
    expect(inventoryFilterReducer(more, { type: "clear" })).toEqual(
      initialInventoryFilterState,
    );
  });
  it("retains last valid result filters until an invalid custom range is fixed", () => {
    let state = inventoryFilterReducer(initialInventoryFilterState, {
      type: "change",
      patch: { stock: "low" },
    });
    const applied = state.appliedFilters;
    state = inventoryFilterReducer(state, {
      type: "change",
      patch: { expiry: "custom", from: "2026-11-12", to: "2026-11-10" },
    });
    expect(state.appliedFilters).toEqual(applied);
    expect(expiryRangeError(state.filters)).not.toBeNull();
    state = inventoryFilterReducer(state, {
      type: "change",
      patch: { to: "2026-11-13" },
    });
    expect(state.appliedFilters).toEqual(state.filters);
    expect(expiryRangeError(state.filters)).toBeNull();
  });
});
