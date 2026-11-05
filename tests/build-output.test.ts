import { afterEach, it, expect, vi } from "vitest";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it("uses an isolated build directory for development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.resetModules();
  const { default: config } = await import("../next.config");
  expect(config.distDir).toBe(".next-dev");
});
it("keeps production assets in the production build directory", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  const { default: config } = await import("../next.config");
  expect(config.distDir).toBe(".next");
});
