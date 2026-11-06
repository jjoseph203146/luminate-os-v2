import { describe, expect, it } from "vitest";
import { clip, deviceLabel, endpointFingerprint, sameKey } from "./rules";

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

describe("sameKey", () => {
  const key = new Uint8Array([4, 1, 2, 3]);
  it("matches equal keys whatever the container", () => {
    expect(sameKey(new Uint8Array([4, 1, 2, 3]).buffer, key)).toBe(true);
    expect(sameKey(new Uint8Array([4, 1, 2, 3]), key)).toBe(true);
  });
  it("matches a view into a bigger buffer by its own bytes only", () => {
    const big = new Uint8Array([9, 4, 1, 2, 3, 9]);
    expect(sameKey(big.subarray(1, 5), key)).toBe(true);
  });
  it("does not match a different key, a different length, or no subscription", () => {
    expect(sameKey(new Uint8Array([4, 1, 2, 9]), key)).toBe(false);
    expect(sameKey(new Uint8Array([4, 1, 2]), key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
    expect(sameKey(undefined, key)).toBe(false);
  });
});

describe("endpointFingerprint", () => {
  it("is a stable 64-character hex id that differs per endpoint and does not contain the endpoint", async () => {
    const a = await endpointFingerprint("https://push.example/abc");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await endpointFingerprint("https://push.example/abc")).toBe(a);
    expect(await endpointFingerprint("https://push.example/abd")).not.toBe(a);
    expect(a).not.toContain("abc");
  });
  it("matches the known SHA-256 of 'abc'", async () => {
    expect(await endpointFingerprint("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
