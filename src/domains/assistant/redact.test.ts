import { describe, expect, it } from "vitest";
import { assertNoBannedKeys, redactText, sanitize } from "./redact";

describe("redactText", () => {
  it("masks emails, phone numbers and Stripe ids", () => {
    expect(redactText("Call Jane at jane@acme.com or (803) 555-0100")).toBe("Call Jane at [email] or [phone]");
    expect(redactText("invoice in_1Tj89WRogbn3MbWH failed for cus_AbCdEfGh1234")).toBe("invoice [stripe-id] failed for [stripe-id]");
  });
  it("leaves the in_progress status and short numbers alone", () => {
    expect(redactText("status in_progress, 5 pages, LUM-1052")).toBe("status in_progress, 5 pages, LUM-1052");
  });
  it("masks credentials inside URLs", () => {
    expect(redactText("https://user:hunter2@example.com/x")).toBe("[redacted-credentials]@example.com/x");
    expect(redactText("https://a.com/mcp?key=abc123&x=1")).toBe("https://a.com/mcp?key=[redacted]&x=1");
  });
});

describe("sanitize", () => {
  it("masks every string, however deep, and keeps numbers and nulls", () => {
    const out = sanitize({ a: ["x@y.co", 3, null], b: { c: "call 803 555 0100 now" } });
    expect(out).toEqual({ a: ["[email]", 3, null], b: { c: "call [phone] now" } });
  });
});

describe("assertNoBannedKeys", () => {
  it("passes clean output", () => {
    expect(() => assertNoBannedKeys({ sites: [{ client: "Acme", status: "up" }] })).not.toThrow();
  });
  it("throws on a banned key anywhere, naming where", () => {
    expect(() => assertNoBannedKeys({ sites: [{ client: "Acme", email: "x" }] })).toThrow(/"email" at result\.sites\[0\]/);
    expect(() => assertNoBannedKeys({ notes: "x" })).toThrow();
    expect(() => assertNoBannedKeys({ contactName: "Jane" })).toThrow();
  });
});
