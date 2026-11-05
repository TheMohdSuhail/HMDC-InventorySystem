import { describe, it, expect } from "vitest";
import {
  authorizeQuantity,
  quantitySchema,
  packedPieces,
} from "../src/lib/quantity";
describe("quantity role boundaries", () => {
  const make = (type: string, ownerId = "CENTRAL") =>
    quantitySchema.parse({
      requestKey: crypto.randomUUID(),
      type,
      ownerId,
      notes: "Test operation",
      items: [{ productId: "p", quantity: "1" }],
    });
  it("only admins can change central or branch inventory", () => {
    for (const type of [
      "SALE",
      "RETURN",
      "ASSIGN",
      "RECEIVE",
      "LOSS",
      "STOCK_IN",
    ]) {
      expect(() =>
        authorizeQuantity(
          { id: "b", role: "BRANCH_MANAGER" },
          make(type, "other"),
        ),
      ).toThrow();
      expect(() =>
        authorizeQuantity({ id: "m", role: "MANUFACTURER" }, make(type, "m")),
      ).toThrow();
      expect(() =>
        authorizeQuantity({ id: "a", role: "ADMIN" }, make(type)),
      ).not.toThrow();
    }
  });
  it("manufacturers can only produce and dispatch their own inventory", () => {
    for (const type of ["READY", "DISPATCH"]) {
      expect(() =>
        authorizeQuantity({ id: "m", role: "MANUFACTURER" }, make(type, "m")),
      ).not.toThrow();
      expect(() =>
        authorizeQuantity(
          { id: "m", role: "MANUFACTURER" },
          make(type, "other"),
        ),
      ).toThrow();
    }
  });
  it("allows branch daily operations only in its own inventory", () => {
    for (const type of [
      "SALE",
      "RETURN",
      "LOSS",
      "DAMAGED",
      "EXPIRED",
      "QUARANTINED",
    ]) {
      expect(() =>
        authorizeQuantity({ id: "b", role: "BRANCH_MANAGER" }, make(type, "b")),
      ).not.toThrow();
      expect(() =>
        authorizeQuantity(
          { id: "b", role: "BRANCH_MANAGER" },
          make(type, "CENTRAL"),
        ),
      ).toThrow();
    }
  });
  it("calculates exact box totals and rejects invalid quantities", () => {
    expect(packedPieces(3, 12, 4)).toBe("40");
    expect(() => packedPieces(0, 1, 0)).toThrow();
    expect(() => packedPieces(999999, 999999, 0)).toThrow();
    expect(() =>
      quantitySchema.parse({
        ...make("READY"),
        items: [{ productId: "p", quantity: "-1" }],
      }),
    ).toThrow();
  });
});
