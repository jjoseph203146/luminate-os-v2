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
  ].map((c) => ({ ...c, present: has(c.name) }));
}
