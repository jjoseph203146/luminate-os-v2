// Input checks for the owner's billing actions. Forms post strings; everything is trimmed and bounded here.
import { z } from "zod";
import { isValidIsoDate } from "@/platform/calendar/business-days";

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const id = (what: string) => z.preprocess((v) => str(v).trim(), z.uuid(`That ${what} was not recognised.`));

/** "$35", "35.00", "1,250.5" → cents. */
const dollars = (label: string, required: boolean) =>
  z.preprocess(
    (v) => {
      const s = str(v).trim().replace(/^\$/, "").replace(/,/g, "");
      return s === "" ? null : s;
    },
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, `Enter the ${label} in dollars, like 35 or 35.00.`)
      .transform((s) => Math.round(Number(s) * 100))
      .pipe(z.number().int().min(required ? 1 : 0, `The ${label} must be more than $0.`).max(10_000_000, `That ${label} looks too large.`))
      .nullable()
      .refine((v) => !required || v !== null, `Enter the ${label}.`),
  );

const isoDate = (label: string) => z.preprocess((v) => str(v).trim(), z.string().refine(isValidIsoDate, `Enter ${label} as a real date.`));

const httpsUrl = z.preprocess(
  (v) => str(v).trim() || null,
  z
    .string()
    .max(500, "That link is too long.")
    .refine((u) => {
      try {
        const url = new URL(u);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    }, "Use an https:// link.")
    .nullable(),
);

const ticked = (message: string) => z.preprocess((v) => str(v), z.string().refine((v) => v === "yes" || v === "on", message));

export const SENDERS = ["luminate", "stripe_invoice", "stripe_autopay"] as const;

export const agreementSchema = z.object({
  clientId: id("client"),
  planName: z.preprocess((v) => str(v).trim().replace(/\s+/g, " ") || null, z.string().max(80, "Plan name is too long.").nullable()),
  monthlyPrice: dollars("monthly price", true),
  anniversaryDay: z.preprocess((v) => Number(str(v).trim()), z.number().int("Pick a day from 1 to 31.").min(1, "Pick a day from 1 to 31.").max(31, "Pick a day from 1 to 31.")),
  startsOn: isoDate("the start date"),
  invoiceSender: z.preprocess((v) => str(v).trim(), z.enum(SENDERS, "Choose who sends the renewal invoice.")),
  paymentLinkUrl: httpsUrl,
});

export const agreementStatusSchema = z.object({
  clientId: id("client"),
  change: z.preprocess((v) => str(v).trim(), z.enum(["pause", "resume", "cancel"], "Choose pause, resume or cancel.")),
  confirm: z.preprocess((v) => str(v), z.string()).optional(),
});

export const markSentSchema = z.object({ cycleId: id("renewal"), invoiceUrl: httpsUrl });
export const cycleSchema = z.object({ cycleId: id("renewal") });
export const actionSchema = z.object({ actionId: id("billing task") });

export const manualPaymentSchema = z.object({
  cycleId: id("renewal"),
  amount: dollars("amount", true),
  paidOn: isoDate("the payment date"),
  method: z.preprocess((v) => str(v).trim(), z.enum(["cash", "check", "bank_transfer", "stripe", "other"], "Choose how it was paid.")),
  note: z.preprocess((v) => str(v).trim() || null, z.string().max(500, "The note is too long.").nullable()),
  confirm: ticked("Tick the box to confirm the payment was received."),
});
