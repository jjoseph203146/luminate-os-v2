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
  ].map((c) => ({ ...c, present: has(c.name) }));
}
