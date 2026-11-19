import { describe, expect, it } from "vitest";
import { checkBotWriteKey } from "./bot-auth";

const KEY = "b".repeat(40);
const OTHER = "c".repeat(40);

describe("checkBotWriteKey", () => {
  it("is unconfigured when the key is missing", () => {
    expect(checkBotWriteKey(`Bearer ${KEY}`, null, null)).toBe("unconfigured");
  });
  it("is unconfigured when the write key is the same as the read-only connector key", () => {
    expect(checkBotWriteKey(`Bearer ${KEY}`, KEY, KEY)).toBe("unconfigured");
  });
  it("accepts a Bearer key and rejects a missing, blank or wrong one, including a different length", () => {
    expect(checkBotWriteKey(`Bearer ${KEY}`, KEY, OTHER)).toBe("ok");
    expect(checkBotWriteKey("Bearer   " + KEY + "  ", KEY, null)).toBe("ok");
    expect(checkBotWriteKey(null, KEY, null)).toBe("denied");
    expect(checkBotWriteKey("Bearer", KEY, null)).toBe("denied");
    expect(checkBotWriteKey("Bearer short", KEY, null)).toBe("denied");
    expect(checkBotWriteKey(`Bearer ${"x".repeat(80)}`, KEY, null)).toBe("denied");
  });
  it("does not read a key from anywhere except the Bearer header", () => {
    expect(checkBotWriteKey(null, KEY, null)).toBe("denied");
  });
});
