import { describe, expect, it } from "vitest";
import { parseInput } from "@/platform/auth/schemas";
import { ValidationError } from "@/platform/errors";
import {
  auditQuerySchema,
  businessProfileSchema,
  calendarSchema,
  carePlanCreateSchema,
  catalogItemCreateSchema,
  catalogItemUpdateSchema,
  holidaySchema,
  inviteSchema,
} from "./schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("businessProfileSchema", () => {
  it("turns blank optional fields into null", () => {
    const v = parseInput(businessProfileSchema, { legalName: " Luminate ", displayName: "", contactEmail: "", phone: " ", mailingAddress: "", websiteUrl: "" });
    expect(v).toEqual({ legalName: "Luminate", displayName: null, contactEmail: null, phone: null, mailingAddress: null, websiteUrl: null });
  });
  it("requires a legal name and valid email and https url", () => {
    expect(() => parseInput(businessProfileSchema, { legalName: "" })).toThrow(ValidationError);
    expect(() => parseInput(businessProfileSchema, { legalName: "x", contactEmail: "nope" })).toThrow(ValidationError);
    expect(() => parseInput(businessProfileSchema, { legalName: "x", websiteUrl: "javascript:alert(1)" })).toThrow(ValidationError);
    expect(parseInput(businessProfileSchema, { legalName: "x", websiteUrl: "https://luminate.example" }).websiteUrl).toBe("https://luminate.example");
  });
});

describe("calendarSchema", () => {
  it("accepts the owner's calendar from form values", () => {
    const v = parseInput(calendarSchema, { timeZone: "America/New_York", workingDays: ["0", "1", "2", "3", "4", "5"] });
    expect(v.workingDays).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("accepts a single checked day", () => {
    expect(parseInput(calendarSchema, { timeZone: "UTC", workingDays: "1" }).workingDays).toEqual([1]);
  });
  it("rejects no days, repeats, out-of-range days and bad zones", () => {
    expect(() => parseInput(calendarSchema, { timeZone: "UTC" })).toThrow(/at least one/i);
    expect(() => parseInput(calendarSchema, { timeZone: "UTC", workingDays: ["1", "1"] })).toThrow(ValidationError);
    expect(() => parseInput(calendarSchema, { timeZone: "UTC", workingDays: ["9"] })).toThrow(ValidationError);
    expect(() => parseInput(calendarSchema, { timeZone: "Nope/Zone", workingDays: ["1"] })).toThrow(ValidationError);
  });
});

describe("holidaySchema", () => {
  it("validates the date and label", () => {
    expect(parseInput(holidaySchema, { date: "2026-11-26", label: "Thanksgiving" })).toEqual({ date: "2026-11-26", label: "Thanksgiving" });
    expect(() => parseInput(holidaySchema, { date: "2026-02-30", label: "x" })).toThrow(ValidationError);
    expect(() => parseInput(holidaySchema, { date: "2026-11-26", label: "" })).toThrow(ValidationError);
  });
});

describe("catalog schemas", () => {
  const update = { id: uuid, name: "Blog", description: "", price: "150", percent: "", benchmark: "184", watchPricing: "on", sortOrder: "50" };
  it("converts dollars to cents and checkboxes to booleans", () => {
    const v = parseInput(catalogItemUpdateSchema, update);
    expect(v).toMatchObject({ price: 15000, percent: null, benchmark: 18400, watchPricing: true, active: false, description: null, sortOrder: 50 });
  });
  it("rejects a bad amount", () => {
    expect(() => parseInput(catalogItemUpdateSchema, { ...update, price: "abc" })).toThrow(/amount/i);
  });
  it("validates the code and enums on create", () => {
    const create = { ...update, code: "new_addon", kind: "addon", pricingModel: "fixed" };
    expect(parseInput(catalogItemCreateSchema, { ...create, id: undefined }).code).toBe("new_addon");
    expect(() => parseInput(catalogItemCreateSchema, { ...create, code: "Bad Code" })).toThrow(ValidationError);
    expect(() => parseInput(catalogItemCreateSchema, { ...create, kind: "other" })).toThrow(ValidationError);
  });
});

describe("carePlanCreateSchema", () => {
  it("parses one service per line", () => {
    const v = parseInput(carePlanCreateSchema, {
      code: "starter_care", name: "Starter", price: "35", smallUpdates: "2", responseDays: "2",
      includedServices: "Hosting\n\nUptime checks\n", sortOrder: "10", prioritySupport: "on",
    });
    expect(v).toMatchObject({ price: 3500, smallUpdates: 2, responseDays: 2, prioritySupport: true, includedServices: ["Hosting", "Uptime checks"] });
  });
  it("rejects a blank number", () => {
    expect(() => parseInput(carePlanCreateSchema, { code: "x1", name: "n", price: "1", smallUpdates: "", responseDays: "1", sortOrder: "1" })).toThrow(ValidationError);
  });
});

describe("misc schemas", () => {
  it("lowercases the invite email", () => {
    expect(parseInput(inviteSchema, { email: " A@B.CO " }).email).toBe("a@b.co");
  });
  it("defaults the audit page to 1", () => {
    expect(parseInput(auditQuerySchema, {})).toEqual({ page: 1, entityType: null, action: null });
    expect(parseInput(auditQuerySchema, { page: "3", action: "catalog" }).page).toBe(3);
    expect(parseInput(auditQuerySchema, { page: "abc" }).page).toBe(1);
  });
});
