// Pure rules for the website contact form. No database, easy to test.
import { z } from "zod";
import { clip } from "@/domains/notifications/rules";
import type { PushPayload } from "@/platform/push/send";

const HONEYPOT_FIELDS = ["_gotcha", "hp", "honeypot", "bot-field", "bot_field"];

/** A real visitor never fills a hidden trap field; a bot often does. */
export function isHoneypotFilled(raw: Record<string, unknown>): boolean {
  return HONEYPOT_FIELDS.some((k) => typeof raw[k] === "string" && raw[k].trim() !== "");
}

// The marketing site's field names are not fixed in this repo, so common spellings are accepted.
const ALIASES = {
  name: ["name", "full_name", "fullName", "fullname", "your_name", "contact_name"],
  businessName: ["business_name", "businessName", "business", "company", "company_name", "organization"],
  email: ["email", "email_address", "emailAddress", "your_email"],
  phone: ["phone", "phone_number", "phoneNumber", "tel", "mobile"],
  notes: ["notes", "message", "details", "project", "description", "comments", "inquiry"],
} as const;

function pick(raw: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const oneLine = (s: string) => s.replace(CONTROL, "").replace(/\s+/g, " ").trim();
const multiLine = (s: string) => s.replace(CONTROL, "").replace(/\r\n?/g, "\n").trim();

export const NOT_GIVEN = "Not given";
export const WEBSITE_SOURCE = "Website form";

const leadSchema = z
  .object({
    name: z.string().transform(oneLine).pipe(z.string().min(1, "Please enter your name.").max(100, "Name is too long.")),
    businessName: z
      .string()
      .transform(oneLine)
      .pipe(z.string().max(150, "Business name is too long."))
      .transform((v) => (v === "" ? NOT_GIVEN : v)),
    email: z
      .string()
      .transform((s) => oneLine(s).toLowerCase())
      .pipe(z.union([z.literal(""), z.email("Please enter a valid email address.").max(254)])),
    phone: z
      .string()
      .transform(oneLine)
      .pipe(z.string().max(40, "Phone number is too long."))
      .refine((v) => v === "" || (v.match(/\d/g) ?? []).length >= 7, "Please enter a valid phone number."),
    notes: z.string().transform(multiLine).pipe(z.string().max(4000, "Message is too long.")),
  })
  .refine((v) => v.email !== "" || v.phone !== "", { message: "Please give an email address or a phone number.", path: ["email"] });

export type WebsiteLeadInput = z.infer<typeof leadSchema>;

export function leadInputFromRaw(raw: Record<string, unknown>): { ok: true; value: WebsiteLeadInput } | { ok: false; issues: string[] } {
  const result = leadSchema.safeParse({
    name: pick(raw, ALIASES.name),
    businessName: pick(raw, ALIASES.businessName),
    email: pick(raw, ALIASES.email),
    phone: pick(raw, ALIASES.phone),
    notes: pick(raw, ALIASES.notes),
  });
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues.map((i) => i.message) };
}

/** The push notification for a new website lead. */
export function leadNotification(lead: { id: string; name: string; businessName: string; email: string; phone: string; notes: string }): PushPayload {
  const who = lead.businessName !== NOT_GIVEN ? `${lead.name} - ${lead.businessName}` : lead.name;
  const contact = lead.email || lead.phone;
  const note = lead.notes ? ` - ${lead.notes}` : "";
  return { title: clip(`New lead: ${who}`, 70), body: clip(`${contact}${note}`, 130), url: `/growth?lead=${lead.id}`, tag: `lead-${lead.id}` };
}
