import { describe, it, expect } from "vitest";
import { D, weightedCost, saleLine, csv } from "../src/lib/math";
import { productSchema, operationSchema } from "../src/lib/validation";
describe("fixed-precision inventory calculations", () => {
  it("preserves negative numeric quantities in CSV", () => {
    expect(csv([{ quantity: "-1.25" }])).toContain('"-1.25"');
  });
  it("uses weighted-average receipt costs", () => {
    expect(weightedCost("10", "80", "10", "100").toString()).toBe("90");
  });
  it("uses the receipt cost when stock is zero", () => {
    expect(weightedCost("0", "999", "3", "80").toString()).toBe("80");
  });
  it("calculates sales, discount, COGS and gross profit exactly", () => {
    const r = saleLine("10", "120", "50", "80");
    expect(r.gross.toString()).toBe("1200");
    expect(r.total.toString()).toBe("1150");
    expect(r.cogs.toString()).toBe("800");
    expect(r.total.minus(r.cogs).toString()).toBe("350");
  });
  it("does not use binary floating-point totals", () => {
    expect(saleLine("3", "0.1", "0", "0.05").total.toString()).toBe("0.3");
    expect(D("0.1").plus("0.2").toString()).toBe("0.3");
  });
  it("rejects excessive discounts", () =>
    expect(() => saleLine("1", "10", "11", "4")).toThrow("Discount"));
  it("exports escaped CSV and neutralizes spreadsheet formulas", () => {
    const result = csv([
      { name: '=HYPERLINK("bad")', value: 'a,b\nc"d', money: "12.34" },
    ]);
    expect(result).toContain('"\'=HYPERLINK(""bad"")"');
    expect(result).toContain('"a,b\nc""d"');
    expect(result).toContain('"12.34"');
  });
  it("accepts a zero-opening-stock product without a SKU or barcode", () => {
    const p = productSchema.parse({
      name: "Herbal Tea",
      purchasePrice: "80",
      sellingPrice: "120",
    });
    expect(p.name).toBe("Herbal Tea");
    expect(p.sku).toBe("");
    expect(p.active).toBe(true);
  });
  it("rejects negative money and quantities with excessive precision", () => {
    expect(
      productSchema.safeParse({
        name: "Tea",
        purchasePrice: "-1",
        sellingPrice: "2",
      }).success,
    ).toBe(false);
    expect(
      operationSchema.safeParse({
        action: "adjustment",
        requestKey: crypto.randomUUID(),
        productId: "a",
        quantity: "1.0001",
        type: "OPENING",
        reason: "Initial inventory",
      }).success,
    ).toBe(false);
  });
});
