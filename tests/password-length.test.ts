import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(async () => "hashed-password"),
  write: vi.fn(async () => ({ id: "target" })),
  transaction: vi.fn(),
}));

vi.mock("../src/lib/auth", () => ({
  currentUser: async () => ({ id: "admin", role: "ADMIN" }),
  checkOrigin: () => {},
  logout: async () => {},
}));
vi.mock("bcryptjs", () => ({
  hash: mocks.hash,
  compare: async () => true,
}));
vi.mock("../src/lib/db", () => ({
  db: {
    user: { findUniqueOrThrow: async () => ({ passwordHash: "existing-hash" }) },
    $transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: async () => [],
      user: {
        findUnique: async () => ({ role: "BRANCH_MANAGER" }),
        count: async () => 1,
        create: mocks.write,
        update: mocks.write,
      },
      session: { deleteMany: async () => ({ count: 0 }) },
      auditLog: { create: async () => ({}) },
    }),
  );
});

describe.each(["create account", "reset account password", "change own password"])(
  "%s password length",
  (operation) => {
    it.each([
      ["12345", 400],
      ["123456", 200],
      ["a".repeat(16), 200],
      ["a".repeat(73), 400],
      ["\u00e9".repeat(37), 400],
    ])("validates %j with status %i without a database", async (password, status) => {
      const own = operation === "change own password";
      const { POST } = own
        ? await import("../src/app/api/account/route")
        : await import("../src/app/api/users/route");
      const body = own
        ? { currentPassword: "existing-password", newPassword: password }
        : {
            ...(operation === "reset account password" ? { id: "target" } : {}),
            email: "target@example.invalid",
            role: "BRANCH_MANAGER",
            active: true,
            password,
          };
      const response = await POST(
        new Request(`http://localhost/api/${own ? "account" : "users"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(status);
      if (status === 200) {
        expect(mocks.hash).toHaveBeenCalledWith(password, 12);
        expect(mocks.write).toHaveBeenCalledOnce();
      } else {
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.hash).not.toHaveBeenCalled();
        if (password.length === 5)
          expect((await response.json()).error).toContain(
            "Password must be at least 6 characters",
          );
      }
    });
  },
);
