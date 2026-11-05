import { it, expect, vi } from "vitest";
vi.mock("../src/lib/auth", () => ({
  currentUser: async () => ({
    id: "owner",
    role: "ADMIN",
    email: "admin@example.invalid",
  }),
  checkOrigin: () => {},
}));
vi.mock("../src/lib/db", () => ({
  db: {
    $transaction: async () => {
      throw new Error("Sensitive database credential details");
    },
  },
}));
it("does not return internal database errors to the browser", async () => {
  const { POST } = await import("../src/app/api/data/route");
  const response = await POST(
    new Request("http://localhost/api/data", {
      method: "POST",
      body: JSON.stringify({
        action: "product",
        data: { name: "A product", purchasePrice: "1", sellingPrice: "2" },
      }),
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("Sensitive");
});
