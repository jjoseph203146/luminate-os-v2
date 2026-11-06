// Input shapes for client changes. Every server action's form data is parsed here first.
import { z } from "zod";

const id = z.string().uuid("That client could not be found.");
/** Hidden "1"/"0" (or "true"/"false") form fields. */
const onOff = z.enum(["1", "0", "true", "false"]).transform((v) => v === "1" || v === "true");
/** A ticked checkbox posts "on"; an unticked one posts nothing. */
const ticked = z
  .union([z.literal("on"), z.literal("true"), z.literal("1"), z.literal(""), z.undefined()])
  .transform((v) => v === "on" || v === "true" || v === "1");

export const clientFlagSchema = z.object({
  clientId: id,
  flag: z.enum(["archived", "on_hold", "monitoring_paused"]),
  on: onOff,
  confirm: ticked.optional(),
});

/** Optional text: trimmed, empty becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : null));

export const clientDetailsSchema = z.object({
  clientId: id,
  businessName: z.string().trim().min(1, "Enter the business name.").max(120, "Use at most 120 characters."),
  // The old app stores "Unknown" and "no-email" when Stripe had nothing; both stay valid here.
  contactName: z
    .string()
    .trim()
    .max(120, "Use at most 120 characters.")
    .transform((v) => v || "Unknown"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Use at most 254 characters.")
    .transform((v) => v || "no-email")
    .refine((v) => v === "no-email" || z.email().safeParse(v).success, "Enter a valid email address, or leave it empty."),
  phone: optionalText(40).refine((v) => v === null || /^[+\d\s().-]{7,40}$/.test(v), "Enter a phone number using digits, spaces, + ( ) - or ."),
  planName: optionalText(80),
  clientSince: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), "Enter a date like 2024-03-01."),
  revisionsIncluded: z.coerce
    .number({ message: "Enter a whole number of updates." })
    .int("Enter a whole number of updates.")
    .min(0, "Use 0 or more.")
    .max(100, "Use 100 or fewer."),
});
export type ClientDetailsInput = z.infer<typeof clientDetailsSchema>;

const label = z
  .string()
  .trim()
  .max(60, "Keep the label to 60 characters.")
  .optional()
  .transform((v) => (v ? v : "Production"));

export const addWebsiteSchema = z.object({ clientId: id, label, url: z.string() });
export const updateWebsiteSchema = z.object({ clientId: id, websiteId: z.string().uuid("That website could not be found."), label, url: z.string() });
export const removeWebsiteSchema = z.object({
  clientId: id,
  websiteId: z.string().uuid("That website could not be found."),
  confirm: ticked.optional(),
});
export const projectUrlSchema = z.object({
  clientId: id,
  projectId: z.string().uuid("That project could not be found."),
  /** Empty clears it, so monitoring falls back to the client's websites. */
  url: z.string().optional().transform((v) => v ?? ""),
});
