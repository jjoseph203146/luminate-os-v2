import { describe, expect, it } from "vitest";
import { tickAuthorized } from "./auth";

const secret = "s".repeat(40);
describe("tickAuthorized", () => {
  it("accepts the exact bearer secret", () => {
    expect(tickAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });
  it("rejects missing, wrong and differently-shaped headers", () => {
    expect(tickAuthorized(null, secret)).toBe(false);
    expect(tickAuthorized("", secret)).toBe(false);
    expect(tickAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(tickAuthorized(secret, secret)).toBe(false);
    expect(tickAuthorized(`bearer ${secret}`, secret)).toBe(false);
  });
});
