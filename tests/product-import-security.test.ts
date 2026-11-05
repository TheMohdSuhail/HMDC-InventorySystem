import { it, expect, vi } from "vitest";
vi.mock("../src/lib/auth", () => ({
  currentUser: async () => ({ id: "user", role: "USER" }),
  checkOrigin: () => {},
}));
it("blocks regular users from product import and template endpoints", async () => {
  const { GET, POST } = await import("../src/app/api/products/bulk/route");
  expect((await GET()).status).toBe(403);
  expect(
    (
      await POST(
        new Request("http://localhost/api/products/bulk", { method: "POST" }),
      )
    ).status,
  ).toBe(403);
});
