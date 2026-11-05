import { describe, expect, it } from "vitest";
import { manufacturerProductSchema } from "../src/lib/validation";

describe("manufacturer product validation", () => {
  it("trims and defaults optional catalog fields", () => {
    expect(manufacturerProductSchema.parse({ name: "  Herbal tea  " })).toEqual(
      {
        name: "Herbal tea",
        sku: "",
        barcode: "",
        category: "",
      },
    );
  });

  it("rejects an empty name and oversized catalog fields", () => {
    expect(() => manufacturerProductSchema.parse({ name: " " })).toThrow();
    expect(() =>
      manufacturerProductSchema.parse({
        name: "Herbal tea",
        barcode: "x".repeat(192),
      }),
    ).toThrow();
  });
});
