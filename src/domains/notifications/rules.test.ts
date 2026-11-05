import { describe, expect, it } from "vitest";
import { clip, deviceLabel } from "./rules";

describe("deviceLabel", () => {
  it("names common devices", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("Android phone");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
    expect(deviceLabel(null)).toBe("Browser");
  });
});
describe("clip", () => {
  it("collapses whitespace and shortens with an ellipsis", () => {
    expect(clip("  a   b \n c ", 50)).toBe("a b c");
    const long = "x".repeat(200);
    expect(clip(long, 10)).toHaveLength(10);
    expect(clip(long, 10).endsWith("…")).toBe(true);
  });
});
