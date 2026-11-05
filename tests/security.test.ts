import { describe, it, expect, vi } from "vitest";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
describe("access and origin protection", () => {
  it("protects bulk product import against unauthenticated access", async () => {
    const bulk = await import("../src/app/api/products/bulk/route");
    expect((await bulk.GET()).status).toBe(401);
    expect(
      (
        await bulk.POST(
          new Request("http://localhost/api/products/bulk", { method: "POST" }),
        )
      ).status,
    ).toBe(401);
  });
  it("returns no user for a missing session without querying inventory", async () => {
    const { currentUser } = await import("../src/lib/auth");
    expect(await currentUser()).toBeNull();
  });
  it("protects every inventory data handler", async () => {
    const { GET, POST } = await import("../src/app/api/data/route");
    expect((await GET()).status).toBe(401);
    expect(
      (await POST(new Request("http://localhost/api/data", { method: "POST" })))
        .status,
    ).toBe(401);
  });
  it("protects reports and exports", async () => {
    const reports = await import("../src/app/api/reports/route");
    const exports = await import("../src/app/api/export/route");
    expect(
      (await reports.GET(new Request("http://localhost/api/reports"))).status,
    ).toBe(401);
    expect(
      (await exports.GET(new Request("http://localhost/api/export"))).status,
    ).toBe(401);
  });
  it("protects account management and password changes", async () => {
    const users = await import("../src/app/api/users/route");
    const account = await import("../src/app/api/account/route");
    expect((await users.GET()).status).toBe(401);
    expect(
      (
        await users.POST(
          new Request("http://localhost/api/users", { method: "POST" }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await account.POST(
          new Request("http://localhost/api/account", { method: "POST" }),
        )
      ).status,
    ).toBe(401);
  });
  it("rejects cross-origin writes", async () => {
    process.env.APP_URL = "https://inventory.example.com";
    const { checkOrigin } = await import("../src/lib/auth");
    expect(() =>
      checkOrigin(
        new Request("https://inventory.example.com/api/data", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toThrow("origin");
    expect(() =>
      checkOrigin(
        new Request("https://inventory.example.com/api/data", {
          headers: { origin: "https://inventory.example.com" },
        }),
      ),
    ).not.toThrow();
  });
});
