import { describe, expect, it } from "vitest";
import { ValidationError } from "@/platform/errors";
import { emailOnlySchema, loginSchema, mfaCodeSchema, newPasswordSchema, parseInput } from "./schemas";

describe("auth schemas", () => {
  it("normalizes the email on sign-in", () => {
    expect(parseInput(loginSchema, { email: "  Me@Example.COM ", password: "x" }).email).toBe("me@example.com");
  });
  it("rejects a bad email and an empty password", () => {
    expect(() => parseInput(loginSchema, { email: "nope", password: "x" })).toThrow(ValidationError);
    expect(() => parseInput(loginSchema, { email: "a@b.co", password: "" })).toThrow(ValidationError);
    expect(() => parseInput(emailOnlySchema, {})).toThrow(ValidationError);
  });
  it("requires a long matching password", () => {
    expect(() => parseInput(newPasswordSchema, { password: "short", confirm: "short" })).toThrow(/12 characters/);
    expect(() => parseInput(newPasswordSchema, { password: "a".repeat(12), confirm: "b".repeat(12) })).toThrow(/do not match/);
    expect(() => parseInput(newPasswordSchema, { password: "a".repeat(73), confirm: "a".repeat(73) })).toThrow(ValidationError);
    expect(parseInput(newPasswordSchema, { password: "a".repeat(12), confirm: "a".repeat(12) }).password).toHaveLength(12);
  });
  it("accepts a 6-digit code with spaces", () => {
    expect(parseInput(mfaCodeSchema, { code: "123 456" }).code).toBe("123456");
    expect(() => parseInput(mfaCodeSchema, { code: "12345" })).toThrow(ValidationError);
    expect(() => parseInput(mfaCodeSchema, { code: "abcdef" })).toThrow(ValidationError);
  });
});
