import { describe, expect, it } from "vitest";
import {
  normalizeOrderNo,
  orderPrefix,
  suggestTeamCode,
  TEAM_CODE,
} from "@/lib/order-id";

describe("order IDs", () => {
  it("reads the team code prefix", () => {
    expect(orderPrefix("TRL1023")).toBe("TRL");
    expect(orderPrefix(" trl-1023 ")).toBe("TRL");
    expect(orderPrefix("AB/2026/7")).toBe("AB");
  });
  it("rejects IDs without a code or number", () => {
    expect(orderPrefix("1023")).toBeNull();
    expect(orderPrefix("TRL")).toBeNull();
    expect(orderPrefix("")).toBeNull();
    expect(orderPrefix("TRL 10 23")).toBe("TRL");
  });
  it("normalizes case and spaces", () => {
    expect(normalizeOrderNo(" trl 1023 ")).toBe("TRL1023");
  });
  it("accepts letter-only team codes", () => {
    expect(TEAM_CODE.test("TRL")).toBe(true);
    expect(TEAM_CODE.test("TR1")).toBe(false);
    expect(TEAM_CODE.test("ABCDEFGHIJK")).toBe(false);
  });
});

describe("team code suggestion", () => {
  it("uses the name's initials", () => {
    expect(suggestTeamCode("Tanveer Rashid Lone")).toBe("TRL");
    expect(suggestTeamCode("Aman Khan")).toBe("AMK");
    expect(suggestTeamCode("Sana")).toBe("SAN");
    expect(suggestTeamCode("  ")).toBe("");
  });
});
