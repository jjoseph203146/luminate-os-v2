import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to max hits per key inside the window, then blocks", () => {
    const l = createRateLimiter({ max: 3, windowMs: 1000 });
    expect([1, 2, 3, 4].map(() => l.check("a", 100))).toEqual([true, true, true, false]);
  });
  it("counts keys separately", () => {
    const l = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(l.check("a", 0)).toBe(true);
    expect(l.check("b", 0)).toBe(true);
    expect(l.check("a", 1)).toBe(false);
  });
  it("lets hits through again once the window has passed", () => {
    const l = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(l.check("a", 0)).toBe(true);
    expect(l.check("a", 999)).toBe(false);
    expect(l.check("a", 1000)).toBe(true);
  });
  it("does not count blocked hits against the window", () => {
    const l = createRateLimiter({ max: 1, windowMs: 1000 });
    l.check("a", 0);
    l.check("a", 500);
    expect(l.check("a", 1000)).toBe(true);
  });
});
