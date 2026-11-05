import { describe, it, expect } from "vitest";
import { authorizeOperation } from "../src/lib/permissions";
import { operationSchema } from "../src/lib/validation";
const op = (values: Record<string, unknown>) =>
  operationSchema.parse({ requestKey: crypto.randomUUID(), ...values });
describe("admin and daily-operation permissions", () => {
  it("blocks legacy users from recording sales", () =>
    expect(() =>
      authorizeOperation(
        "USER",
        op({ action: "sale", items: [{ productId: "p", quantity: "1" }] }),
      ),
    ).toThrow("Admin"));
  it("reserves price overrides for admins", () =>
    expect(() =>
      authorizeOperation(
        "USER",
        op({
          action: "sale",
          items: [
            {
              productId: "p",
              quantity: "1",
              overridePrice: "1",
              overrideReason: "Promotional discount",
            },
          ],
        }),
      ),
    ).toThrow("Admin"));
  it("reserves discounts for admins", () =>
    expect(() =>
      authorizeOperation(
        "USER",
        op({
          action: "sale",
          items: [{ productId: "p", quantity: "1", discount: "1" }],
        }),
      ),
    ).toThrow("Admin"));
  it("reserves all returns for admins", () => {
    expect(() =>
      authorizeOperation(
        "USER",
        op({
          action: "return",
          reason: "Returned unopened",
          items: [
            {
              productId: "p",
              saleItemId: "s",
              quantity: "1",
              condition: "SELLABLE",
            },
          ],
        }),
      ),
    ).toThrow("Admin");
    expect(() =>
      authorizeOperation(
        "USER",
        op({
          action: "return",
          reason: "Returned unopened",
          items: [{ productId: "p", quantity: "1", condition: "SELLABLE" }],
        }),
      ),
    ).toThrow("Admin");
  });
  it("reserves receipts and losses for admins", () => {
    expect(() =>
      authorizeOperation(
        "USER",
        op({
          action: "receipt",
          orderId: "o",
          items: [{ orderItemId: "i", quantity: "1" }],
        }),
      ),
    ).toThrow("Admin");
    expect(() =>
      authorizeOperation(
        "USER",
        op({
          action: "adjustment",
          productId: "p",
          quantity: "1",
          type: "DAMAGED",
          reason: "Damaged packaging",
        }),
      ),
    ).toThrow("Admin");
  });
  it("reserves opening stock, corrections and recovery for admins", () => {
    for (const type of [
      "OPENING",
      "CORRECTION_IN",
      "CORRECTION_OUT",
      "RECOVERY",
    ])
      expect(() =>
        authorizeOperation(
          "USER",
          op({
            action: "adjustment",
            productId: "p",
            quantity: "1",
            type,
            reason: "Inventory correction",
          }),
        ),
      ).toThrow("Admin");
  });
  it("reserves purchases, payments and cancellation for admins", () => {
    const actions = [
      {
        action: "purchase",
        supplierId: "s",
        items: [{ productId: "p", quantity: "1", unitCost: "1" }],
      },
      { action: "payment", orderId: "o", amount: "1", method: "Cash" },
      { action: "cancelSale", saleId: "s", reason: "Mistaken entry" },
      {
        action: "orderStatus",
        orderId: "o",
        status: "CANCELLED",
        reason: "Mistaken entry",
      },
    ];
    for (const a of actions) {
      expect(() => authorizeOperation("USER", op(a))).toThrow("Admin");
      expect(() => authorizeOperation("ADMIN", op(a))).not.toThrow();
    }
  });
});
