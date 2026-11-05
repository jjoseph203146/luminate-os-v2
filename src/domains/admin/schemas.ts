import { z } from "zod";
import { isValidIsoDate, isValidTimeZone } from "@/platform/calendar/business-days";
import { linesToList, parseDollarsToCents } from "./rules";

// Form fields arrive as strings (or missing). These helpers turn them into typed values.
const blankToNull = (v: unknown) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" ? v.trim() : v);

const optionalText = (max: number) => z.preprocess(blankToNull, z.string().max(max).nullable());

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const intField = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN), z.number().int().min(min).max(max));

const dollars = z.string().trim().transform((s, ctx) => {
  const cents = parseDollarsToCents(s);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 49 or 49.50." });
    return z.NEVER;
  }
  return cents;
});

const optionalDollars = z.preprocess(blankToNull, dollars.nullable());

const optionalPercent = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : Number(v)),
  z.number().gt(0).max(1000).nullable(),
);

const codeField = z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "Use lowercase letters, numbers and underscores, starting with a letter.");

export const businessProfileSchema = z.object({
  legalName: z.string().trim().min(1, "Legal name is required.").max(200),
  displayName: optionalText(100),
  contactEmail: z.preprocess(blankToNull, z.email().max(200).nullable()),
  phone: optionalText(40),
  mailingAddress: optionalText(500),
  websiteUrl: z.preprocess(blankToNull, z.url({ protocol: /^https?$/ }).max(300).nullable()),
});

export const calendarSchema = z.object({
  timeZone: z.string().trim().refine(isValidTimeZone, "Not a valid IANA time zone, for example America/New_York."),
  workingDays: z.preprocess(
    (v) => (Array.isArray(v) ? v.map(Number) : v === undefined || v === "" ? [] : [Number(v)]),
    z
      .array(z.number().int().min(0).max(6))
      .min(1, "Choose at least one working day.")
      .refine((a) => new Set(a).size === a.length, "Working days must not repeat."),
  ),
});

export const holidaySchema = z.object({
  date: z.string().trim().refine(isValidIsoDate, "Enter a real date as YYYY-MM-DD."),
  label: z.string().trim().min(1, "A label is required.").max(100),
});

export const holidayRemoveSchema = z.object({
  date: z.string().trim().refine(isValidIsoDate, "Enter a real date as YYYY-MM-DD."),
});

export const catalogItemUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: optionalText(2000),
  price: optionalDollars,
  percent: optionalPercent,
  benchmark: optionalDollars,
  watchPricing: checkbox,
  active: checkbox,
  sortOrder: intField(0, 10000),
});

export const catalogItemCreateSchema = catalogItemUpdateSchema.omit({ id: true }).extend({
  code: codeField,
  kind: z.enum(["package", "addon"]),
  pricingModel: z.enum(["fixed", "percent", "quoted"]),
});

const servicesField = z.preprocess((v) => (typeof v === "string" ? linesToList(v) : []), z.array(z.string()));

export const carePlanUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required.").max(80),
  price: dollars,
  smallUpdates: intField(0, 99),
  responseDays: intField(1, 30),
  prioritySupport: checkbox,
  includedServices: servicesField,
  active: checkbox,
  sortOrder: intField(0, 10000),
});

export const carePlanCreateSchema = carePlanUpdateSchema.omit({ id: true }).extend({ code: codeField });

export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) });

export const userIdSchema = z.object({ userId: z.uuid() });

export const auditQuerySchema = z.object({
  page: z.preprocess((v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 1), z.number().int().min(1).max(10000)),
  entityType: z.preprocess(blankToNull, z.string().max(60).nullable()),
  action: z.preprocess(blankToNull, z.string().max(80).nullable()),
});
