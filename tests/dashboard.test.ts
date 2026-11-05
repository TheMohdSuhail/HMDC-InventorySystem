import { describe, expect, it } from "vitest";
import { dashboardSummary } from "../src/lib/dashboard";

const product = (id: string, expiryDate: string | null, stock = "2") => ({
  id,
  name: id,
  active: true,
  stock,
  expiryDate,
});
describe("dashboard summaries", () => {
  it("includes today and the one-year boundary, excludes expired, undated and empty stock", () => {
    const result = dashboardSummary(
      [
        product("today", "2026-10-27"),
        product("year", "2027-10-27"),
        product("later", "2027-10-28"),
        product("expired", "2026-10-26"),
        product("unknown", null),
        product("empty", "2026-11-01", "0"),
      ],
      [],
      [],
      "5",
      "2026-10-27",
    );
    expect(result.expiring.map((p) => p.id)).toEqual(["today", "year"]);
    expect(result.expired.map((p) => p.id)).toEqual(["expired"]);
    expect(result.out.map((p) => p.id)).toEqual(["empty"]);
  });
  it("ranks net sales precisely, includes completed earlier sales and excludes other events", () => {
    const result = dashboardSummary(
      [product("a", null), product("b", null)],
      [
        {
          type: "SALE",
          items: [{ productId: "a", quantity: "0.3", processed: "0.1" }],
        },
        {
          type: "RETURN",
          items: [{ productId: "a", quantity: "0.1", processed: "0" }],
        },
        {
          type: "DISPATCH",
          items: [{ productId: "b", quantity: "100", processed: "0" }],
        },
      ],
      [
        {
          status: "COMPLETED",
          items: [
            { productId: "a", quantity: "0.1", returned: "0" },
            { productId: "b", quantity: "2", returned: "1" },
          ],
        },
        {
          status: "CANCELLED",
          items: [{ productId: "a", quantity: "100", returned: "0" }],
        },
      ],
      "5",
      "2026-10-27",
    );
    expect(result.top.map((p) => [p.id, p.quantity])).toEqual([
      ["b", "1"],
      ["a", "0.3"],
    ]);
  });
  it("uses per-product stock thresholds and excludes archived products from replenishment", () => {
    const result = dashboardSummary(
      [
        { ...product("custom", null, "3"), minStock: "2" },
        product("default", null, "3"),
        { ...product("archived", null, "0"), active: false },
      ],
      [],
      [],
      "5",
      "2026-10-27",
    );
    expect(result.low.map((p) => p.id)).toEqual(["default"]);
    expect(result.out).toEqual([]);
    expect(result.top).toEqual([]);
  });
});
