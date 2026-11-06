// Environment access. Reports variable NAMES only; never prints values.
import { z } from "zod";
import { isMfaRequired } from "@/platform/auth/rules";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

const cronSchema = z.object({
  CRON_SECRET: z.string().min(32),
});

const appSchema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  APP_URL: z.url().optional(),
  AUTH_REQUIRE_MFA: z.enum(["true", "false"]).default("false"),
});

export class EnvError extends Error {
  readonly names: string[];
  constructor(names: string[]) {
    super(`Missing or invalid environment variables: ${names.join(", ")}`);
    this.name = "EnvError";
    this.names = names;
  }
}

function parse<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new EnvError(names);
  }
  return result.data;
}

export function getPublicEnv(source: NodeJS.ProcessEnv = process.env) {
  return parse(publicSchema, source);
}

export function getServiceRoleKey(source: NodeJS.ProcessEnv = process.env): string {
  return parse(serverSchema, source).SUPABASE_SERVICE_ROLE_KEY;
}

export function getCronSecret(source: NodeJS.ProcessEnv = process.env): string | null {
  const r = cronSchema.safeParse(source);
  return r.success ? r.data.CRON_SECRET : null;
}

const mcpSchema = z.object({
  MCP_API_KEY: z.string().min(32),
});

/** The key the AI assistant connector (/api/mcp) accepts. Null when unset or shorter than 32 characters: the connector is then off. */
export function getMcpKey(source: NodeJS.ProcessEnv = process.env): string | null {
  const r = mcpSchema.safeParse(source);
  return r.success ? r.data.MCP_API_KEY : null;
}

const pushSchema = z.object({
  VAPID_PUBLIC_KEY: z.string().min(40),
  VAPID_PRIVATE_KEY: z.string().min(20),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "must start with mailto: or https://"),
});

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Null when push notifications are not configured (they are then simply off). */
export function getPushConfig(source: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const r = pushSchema.safeParse(source);
  return r.success ? { publicKey: r.data.VAPID_PUBLIC_KEY, privateKey: r.data.VAPID_PRIVATE_KEY, subject: r.data.VAPID_SUBJECT } : null;
}

export interface StripeConfig {
  secretKey: string;
  /** Signing secret of the LIVE webhook endpoint. */
  webhookSecret: string | null;
  /** Signing secret of a TEST-mode webhook endpoint (optional). */
  webhookSecretTest: string | null;
}

const stripeKeySchema = z.string().regex(/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/, "must be a Stripe secret or restricted key");
const whsecSchema = z.string().regex(/^whsec_[A-Za-z0-9]{10,}$/, "must be a Stripe webhook signing secret");

/** Null when Stripe is not configured (the webhook then refuses every request). Never prints values. */
export function getStripeConfig(source: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const key = stripeKeySchema.safeParse(source.STRIPE_SECRET_KEY?.trim());
  if (!key.success) return null;
  const live = whsecSchema.safeParse(source.STRIPE_WEBHOOK_SECRET?.trim());
  const test = whsecSchema.safeParse(source.STRIPE_WEBHOOK_SECRET_TEST?.trim());
  return { secretKey: key.data, webhookSecret: live.success ? live.data : null, webhookSecretTest: test.success ? test.data : null };
}

/** Google API key for PageSpeed Insights (speed and visual checks). Null when unset: the checks then run without a key (low shared quota). */
export function getPagespeedKey(source: NodeJS.ProcessEnv = process.env): string | null {
  const v = source.PAGESPEED_API_KEY?.trim();
  return v && v.length >= 20 ? v : null;
}

const DEFAULT_LEAD_ORIGINS = ["https://luminatewebdesign.com", "https://www.luminatewebdesign.com"];

/** Websites allowed to post the contact form. Comma-separated LEAD_FORM_ORIGINS overrides the default. */
export function getLeadFormOrigins(source: NodeJS.ProcessEnv = process.env): string[] {
  const raw = source.LEAD_FORM_ORIGINS;
  if (!raw) return DEFAULT_LEAD_ORIGINS;
  const list = raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => /^https?:\/\/[^/\s]+$/.test(s));
  return list.length > 0 ? list : DEFAULT_LEAD_ORIGINS;
}

export function getAppSettings(source: NodeJS.ProcessEnv = process.env) {
  const app = parse(appSchema, source);
  return {
    appEnv: app.APP_ENV,
    appUrl: app.APP_URL ?? null,
    mfaSwitch: app.AUTH_REQUIRE_MFA === "true",
    mfaRequired: isMfaRequired(app.APP_ENV, app.AUTH_REQUIRE_MFA === "true"),
  };
}

export interface EnvCheck {
  name: string;
  required: boolean;
  present: boolean;
}

/** Which variables are set. Names and yes/no only. */
export function envChecks(source: NodeJS.ProcessEnv = process.env): EnvCheck[] {
  const has = (name: string) => typeof source[name] === "string" && source[name] !== "";
  return [
    { name: "NEXT_PUBLIC_SUPABASE_URL", required: true },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true },
    { name: "SUPABASE_SERVICE_ROLE_KEY", required: true },
    { name: "CRON_SECRET", required: true },
    { name: "APP_URL", required: true },
    { name: "APP_ENV", required: false },
    { name: "AUTH_REQUIRE_MFA", required: false },
    { name: "VAPID_PUBLIC_KEY", required: false },
    { name: "VAPID_PRIVATE_KEY", required: false },
    { name: "VAPID_SUBJECT", required: false },
    { name: "LEAD_FORM_ORIGINS", required: false },
    { name: "STRIPE_SECRET_KEY", required: false },
    { name: "STRIPE_WEBHOOK_SECRET", required: false },
    { name: "STRIPE_WEBHOOK_SECRET_TEST", required: false },
    { name: "PAGESPEED_API_KEY", required: false },
    { name: "MCP_API_KEY", required: false },
  ].map((c) => ({ ...c, present: has(c.name) }));
}
