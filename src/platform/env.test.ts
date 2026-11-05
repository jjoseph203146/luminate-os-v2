import { describe, expect, it } from "vitest";
import { envChecks, EnvError, getAppSettings, getCronSecret, getPublicEnv } from "./env";

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(30),
} as unknown as NodeJS.ProcessEnv;

describe("env", () => {
  it("reads valid public settings", () => {
    expect(getPublicEnv(good).NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });
  it("names missing variables without echoing values", () => {
    try {
      getPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" } as unknown as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const err = e as EnvError;
      expect(err.names).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(err.names).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      expect(err.message).not.toContain("not a url");
    }
  });
  it("ignores a short cron secret", () => {
    expect(getCronSecret({ CRON_SECRET: "short" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getCronSecret({ CRON_SECRET: "x".repeat(32) } as unknown as NodeJS.ProcessEnv)).toBe("x".repeat(32));
  });
  it("defaults to local with MFA off, and follows the switch alone (production too)", () => {
    expect(getAppSettings({} as NodeJS.ProcessEnv)).toMatchObject({ appEnv: "local", mfaRequired: false });
    expect(getAppSettings({ APP_ENV: "production" } as unknown as NodeJS.ProcessEnv).mfaRequired).toBe(false);
    expect(getAppSettings({ APP_ENV: "production", AUTH_REQUIRE_MFA: "true" } as unknown as NodeJS.ProcessEnv).mfaRequired).toBe(true);
    expect(getAppSettings({ APP_ENV: "staging", AUTH_REQUIRE_MFA: "true" } as unknown as NodeJS.ProcessEnv).mfaRequired).toBe(true);
  });
  it("reports presence only", () => {
    const checks = envChecks({ CRON_SECRET: "secret-value" } as unknown as NodeJS.ProcessEnv);
    expect(checks.find((c) => c.name === "CRON_SECRET")?.present).toBe(true);
    expect(checks.find((c) => c.name === "APP_URL")?.present).toBe(false);
    expect(JSON.stringify(checks)).not.toContain("secret-value");
  });
});
