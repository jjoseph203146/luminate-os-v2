import { describe, expect, it } from "vitest";
import { centsToInput, disableProblem, formatCents, isActiveUser, linesToList, parseDollarsToCents, pricingProblem } from "./rules";

describe("parseDollarsToCents", () => {
  it("parses whole and fractional dollars", () => {
    expect(parseDollarsToCents("49")).toBe(4900);
    expect(parseDollarsToCents("49.5")).toBe(4950);
    expect(parseDollarsToCents("$1,200.05")).toBe(120005);
    expect(parseDollarsToCents("0")).toBe(0);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "12345678", "$"]) expect(parseDollarsToCents(bad)).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats with grouping", () => {
    expect(formatCents(50000)).toBe("$500.00");
    expect(formatCents(3500)).toBe("$35.00");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(5)).toBe("$0.05");
  });
  it("round-trips through the input format", () => {
    expect(centsToInput(4900)).toBe("49.00");
    expect(centsToInput(null)).toBe("");
    expect(parseDollarsToCents(centsToInput(18400)!)).toBe(18400);
  });
});

describe("linesToList", () => {
  it("trims, drops blanks and limits size", () => {
    expect(linesToList("  a \r\n\n b\n")).toEqual(["a", "b"]);
    expect(linesToList("x".repeat(300))[0]).toHaveLength(120);
    expect(linesToList(Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n"))).toHaveLength(20);
  });
});

describe("pricingProblem", () => {
  it("accepts matching shapes", () => {
    expect(pricingProblem("fixed", { priceCents: 100, percentValue: null })).toBeNull();
    expect(pricingProblem("percent", { priceCents: null, percentValue: 35 })).toBeNull();
    expect(pricingProblem("quoted", { priceCents: null, percentValue: null })).toBeNull();
  });
  it("rejects mismatches", () => {
    expect(pricingProblem("fixed", { priceCents: null, percentValue: null })).not.toBeNull();
    expect(pricingProblem("fixed", { priceCents: 1, percentValue: 5 })).not.toBeNull();
    expect(pricingProblem("percent", { priceCents: null, percentValue: null })).not.toBeNull();
    expect(pricingProblem("percent", { priceCents: 5, percentValue: 5 })).not.toBeNull();
    expect(pricingProblem("quoted", { priceCents: 5, percentValue: null })).not.toBeNull();
  });
});

describe("disableProblem", () => {
  const base = { actorUserId: "a", targetUserId: "b", targetIsActiveOwner: true, activeOwnerCount: 2 };
  it("allows disabling another owner when another remains", () => {
    expect(disableProblem(base)).toBeNull();
  });
  it("blocks self and the last active owner", () => {
    expect(disableProblem({ ...base, targetUserId: "a" })).toMatch(/own account/);
    expect(disableProblem({ ...base, activeOwnerCount: 1 })).toMatch(/last active owner/);
  });
  it("lets a non-owner be disabled even when one owner exists", () => {
    expect(disableProblem({ ...base, targetIsActiveOwner: false, activeOwnerCount: 1 })).toBeNull();
  });
});

describe("isActiveUser", () => {
  const now = new Date("2026-11-04T00:00:00Z");
  it("is active without a ban or after it ends", () => {
    expect(isActiveUser(null, now)).toBe(true);
    expect(isActiveUser("2026-01-01T00:00:00Z", now)).toBe(true);
  });
  it("is inactive during a ban", () => {
    expect(isActiveUser("2126-01-01T00:00:00Z", now)).toBe(false);
  });
});
