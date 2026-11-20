// Input checks for adding and editing leads by hand. The website form has its own in intake.ts.
import { z } from "zod";
import { isValidIsoDate } from "@/platform/calendar/business-days";
import { NOT_GIVEN } from "./intake";
import { LEAD_KINDS, LOST_REASONS, STAGES } from "./types";

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const oneLine = (s: string) => s.replace(CONTROL, "").replace(/\s+/g, " ").trim();
const multiLine = (s: string) => s.replace(CONTROL, "").replace(/\r\n?/g, "\n").trim();
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** A blank one-line field becomes null. */
const optionalLine = (max: number, label: string) =>
  z.preprocess((v) => oneLine(str(v)) || null, z.string().max(max, `${label} is too long.`).nullable());

/** The largest deal value accepted, so a typo of extra zeros is caught. */
export const MAX_LEAD_VALUE = 10_000_000;

/** "$2,500.00", "2500" or "2500.5" → a number of dollars; blank → null. */
const dealValue = z.preprocess(
  (v) => {
    const s = oneLine(str(v)).replace(/^\$/, "").replace(/,/g, "");
    return s === "" ? null : s;
  },
  z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter the deal value as a number of dollars, like 2500 or 2500.50.")
    .transform(Number)
    .pipe(z.number().max(MAX_LEAD_VALUE, "That deal value looks too large."))
    .nullable(),
);

const phone = z.preprocess(
  (v) => oneLine(str(v)) || null,
  z
    .string()
    .max(40, "Phone number is too long.")
    .regex(/^[0-9+().\-\s/xX#*]+$/, "Phone numbers can only use digits, spaces and + ( ) - .")
    .refine((p) => (p.match(/\d/g) ?? []).length >= 7, "That phone number is too short.")
    .nullable(),
);

const email = z.preprocess(
  (v) => oneLine(str(v)).toLowerCase() || null,
  z.email("Enter a valid email address.").max(254, "Email address is too long.").nullable(),
);

const followUpDate = z.preprocess(
  (v) => oneLine(str(v)) || null,
  z.string().refine(isValidIsoDate, "Enter the follow-up date as a real date.").nullable(),
);

const nextStepOn = z.preprocess(
  (v) => oneLine(str(v)) || null,
  z.string().refine(isValidIsoDate, "Enter the next-step date as a real date.").nullable(),
);

const nextStep = optionalLine(200, "Next step");
const campaign = optionalLine(80, "Campaign");

const lostReason = z.preprocess(
  (v) => oneLine(str(v)) || null,
  z.enum(LOST_REASONS, "Pick a lost reason.").nullable(),
);

const kind = z.preprocess(
  (v) => oneLine(str(v)) || null,
  z.enum(LEAD_KINDS, "Kind is inbound or outbound.").nullable(),
);

/** ISO date-time, or blank for null. Stored as UTC. */
const lastTouchAt = z.preprocess((v) => {
  const s = oneLine(str(v));
  if (!s) return null;
  const at = Date.parse(s);
  return Number.isNaN(at) ? s : new Date(at).toISOString();
}, z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Enter the last touch as a date and time.").nullable());

/** A ticked checkbox, JSON true, or "yes". Anything else, including a missing field, is false. */
const ticked = z.preprocess((v) => {
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "yes" || s === "on" || s === "true" || s === "1";
  }
  return false;
}, z.boolean());

const optionalClientId = z.preprocess(
  (v) => oneLine(str(v)) || null,
  z.uuid("That client was not recognised.").nullable(),
);

const id = z.preprocess((v) => str(v).trim(), z.uuid("That lead was not recognised."));

const fields = {
  name: z.preprocess((v) => oneLine(str(v)), z.string().min(1, "Enter the contact's name.").max(100, "Name is too long.")),
  businessName: z.preprocess(
    (v) => oneLine(str(v)) || NOT_GIVEN,
    z.string().max(150, "Business name is too long."),
  ),
  email,
  phone,
  notes: z.preprocess((v) => multiLine(str(v)) || null, z.string().max(5000, "Notes are too long.").nullable()),
  followUpDate,
  source: optionalLine(80, "Source"),
  value: dealValue,
  nextStep,
  nextStepOn,
  lostReason,
  kind,
  campaign,
};

export const createLeadSchema = z.object(fields);
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({ id, ...fields });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

/** A partial edit. Omitted fields are left as they are. Used by the bot write API. */
const PATCH_FIELD_NAMES = ["name", "businessName", "email", "phone", "notes", "followUpDate", "source", "value", "stage", "nextStep", "nextStepOn", "lostReason", "lastTouchAt", "kind", "campaign"] as const;

export const patchLeadSchema = z
  .object({
    id,
    name: fields.name.optional(),
    businessName: fields.businessName.optional(),
    email: fields.email.optional(),
    phone: fields.phone.optional(),
    notes: fields.notes.optional(),
    followUpDate: fields.followUpDate.optional(),
    source: fields.source.optional(),
    value: fields.value.optional(),
    stage: z.enum(STAGES).optional(),
    nextStep: fields.nextStep.optional(),
    nextStepOn: fields.nextStepOn.optional(),
    lostReason: fields.lostReason.optional(),
    lastTouchAt: lastTouchAt.optional(),
    kind: fields.kind.optional(),
    campaign: fields.campaign.optional(),
    contractSigned: ticked.optional(),
    depositPaid: ticked.optional(),
    clientId: optionalClientId.optional(),
  })
  .refine((v) => PATCH_FIELD_NAMES.some((k) => v[k] !== undefined), { message: "Send at least one field to change." })
  .superRefine((v, ctx) => {
    if (v.stage === "won" && (!v.contractSigned || !v.depositPaid)) {
      ctx.addIssue({ code: "custom", message: "Won means the contract is signed and the deposit is paid. Send both as true." });
    }
    if (v.stage !== "won" && v.clientId) {
      ctx.addIssue({ code: "custom", message: "A client can only be chosen when the lead is moved to Won." });
    }
  });
export type PatchLeadInput = z.infer<typeof patchLeadSchema>;

export const leadStageSchema = z
  .object({
    id,
    stage: z.preprocess((v) => str(v).trim(), z.enum(STAGES, "Pick a stage.")),
    lostReason: lostReason.optional(),
    contractSigned: ticked.optional(),
    depositPaid: ticked.optional(),
    clientId: optionalClientId.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.stage === "won" && (!v.contractSigned || !v.depositPaid)) {
      ctx.addIssue({ code: "custom", message: "Won means the contract is signed and the deposit is paid. Tick both." });
    }
    if (v.stage === "lost" && !v.lostReason) {
      ctx.addIssue({ code: "custom", message: "Pick a reason for marking the lead lost." });
    }
    if (v.stage !== "won" && v.clientId) {
      ctx.addIssue({ code: "custom", message: "A client can only be chosen when the lead is Won." });
    }
  });

export const leadFollowUpSchema = z.object({ id, followUpDate });

export const deleteLeadSchema = z.object({
  id,
  confirm: z.preprocess((v) => str(v), z.string().refine((v) => v === "yes" || v === "on", "Tick the box to confirm.")),
});
