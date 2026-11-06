import { describe, expect, it } from "vitest";
import { checkMcpKey, presentedKey } from "./mcp-auth";

const KEY = "k".repeat(40);

describe("presentedKey", () => {
  it("prefers the Bearer header over the query value", () => {
    expect(presentedKey("Bearer from-header", "from-query")).toBe("from-header");
  });
  it("falls back to the query value, and trims both", () => {
    expect(presentedKey(null, " abc ")).toBe("abc");
    expect(presentedKey("bearer   spaced  ", null)).toBe("spaced");
  });
  it("is empty when nothing usable was sent", () => {
    expect(presentedKey(null, null)).toBe("");
    expect(presentedKey("Basic abc", null)).toBe("");
    expect(presentedKey("Bearer ", "")).toBe("");
  });
});

describe("checkMcpKey", () => {
  it("accepts the right key in the Bearer header", () => {
    expect(checkMcpKey(`Bearer ${KEY}`, null, KEY)).toBe("ok");
  });
  it("accepts the right key in the query", () => {
    expect(checkMcpKey(null, KEY, KEY)).toBe("ok");
  });
  it("refuses a wrong key, a near miss, a longer key and no key", () => {
    expect(checkMcpKey(`Bearer ${"x".repeat(40)}`, null, KEY)).toBe("denied");
    expect(checkMcpKey(null, `${KEY.slice(0, -1)}x`, KEY)).toBe("denied");
    expect(checkMcpKey(null, `${KEY}k`, KEY)).toBe("denied");
    expect(checkMcpKey(null, null, KEY)).toBe("denied");
  });
  it("lets the header win: a wrong header is refused even with a right query key", () => {
    expect(checkMcpKey("Bearer wrong", KEY, KEY)).toBe("denied");
    expect(checkMcpKey(`Bearer ${KEY}`, "wrong", KEY)).toBe("ok");
  });
  it("refuses everything when no key is configured (unset or too short)", () => {
    expect(checkMcpKey(`Bearer ${KEY}`, KEY, null)).toBe("unconfigured");
    expect(checkMcpKey(null, "", null)).toBe("unconfigured");
  });
  it("compares keys of different lengths without throwing", () => {
    expect(() => checkMcpKey(null, "a", KEY)).not.toThrow();
    expect(checkMcpKey(null, "a".repeat(500), KEY)).toBe("denied");
  });
});
