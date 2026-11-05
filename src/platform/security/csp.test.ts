import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc123", isDev: false });
  it("carries the nonce and blocks framing and plugins", () => {
    expect(prod).toContain("'nonce-abc123'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
  });
  it("has no inline-script or eval exception in production", () => {
    const script = prod.split("; ").find((d) => d.startsWith("script-src")) ?? "";
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(prod).toContain("upgrade-insecure-requests");
  });
  it("allows eval and websockets only in development", () => {
    const dev = buildCsp({ nonce: "n", isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});
