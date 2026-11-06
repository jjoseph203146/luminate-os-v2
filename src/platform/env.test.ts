import { describe, expect, it } from "vitest";
import { envChecks, EnvError, getAppSettings, getCronSecret, getMcpKey, getPublicEnv, getStripeConfig, getPagespeedKey, getStripeInvoiceKey } from "./env";

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
      getPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" } as unknown as unknown as NodeJS.ProcessEnv);
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
    expect(getCronSecret({ CRON_SECRET: "short" } as unknown as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getCronSecret({ CRON_SECRET: "x".repeat(32) } as unknown as unknown as NodeJS.ProcessEnv)).toBe("x".repeat(32));
  });
  it("ignores an unset or short assistant connector key", () => {
    expect(getMcpKey({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getMcpKey({ MCP_API_KEY: "x".repeat(31) } as unknown as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getMcpKey({ MCP_API_KEY: "x".repeat(32) } as unknown as unknown as NodeJS.ProcessEnv)).toBe("x".repeat(32));
  });
  it("defaults to local with MFA off, and follows the switch alone (production too)", () => {
    expect(getAppSettings({} as unknown as NodeJS.ProcessEnv)).toMatchObject({ appEnv: "local", mfaRequired: false });
    expect(getAppSettings({ APP_ENV: "production" } as unknown as unknown as NodeJS.ProcessEnv).mfaRequired).toBe(false);
    expect(getAppSettings({ APP_ENV: "production", AUTH_REQUIRE_MFA: "true" } as unknown as unknown as NodeJS.ProcessEnv).mfaRequired).toBe(true);
    expect(getAppSettings({ APP_ENV: "staging", AUTH_REQUIRE_MFA: "true" } as unknown as unknown as NodeJS.ProcessEnv).mfaRequired).toBe(true);
  });
  it("lists the assistant connector key as optional", () => {
    const check = envChecks({ MCP_API_KEY: "k".repeat(40) } as unknown as unknown as NodeJS.ProcessEnv).find((c) => c.name === "MCP_API_KEY");
    expect(check).toEqual({ name: "MCP_API_KEY", required: false, present: true });
  });
  it("reports presence only", () => {
    const checks = envChecks({ CRON_SECRET: "secret-value" } as unknown as unknown as NodeJS.ProcessEnv);
    expect(checks.find((c) => c.name === "CRON_SECRET")?.present).toBe(true);
    expect(checks.find((c) => c.name === "APP_URL")?.present).toBe(false);
    expect(JSON.stringify(checks)).not.toContain("secret-value");
  });
});

describe("getStripeConfig", () => {
  const key = `sk_test_${"x".repeat(24)}`;
  const whsec = `whsec_${"y".repeat(24)}`;
  it("is null without a valid secret or restricted key, so the webhook refuses everything", () => {
    expect(getStripeConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getStripeConfig({ STRIPE_SECRET_KEY: "pk_live_notasecret1234567890" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getStripeConfig({ STRIPE_SECRET_KEY: "nonsense" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it("accepts a secret or restricted key, with optional live and test signing secrets", () => {
    expect(getStripeConfig({ STRIPE_SECRET_KEY: key } as unknown as NodeJS.ProcessEnv)).toEqual({ secretKey: key, webhookSecret: null, webhookSecretTest: null });
    const restricted = `rk_live_${"z".repeat(24)}`;
    expect(getStripeConfig({ STRIPE_SECRET_KEY: ` ${restricted} `, STRIPE_WEBHOOK_SECRET: whsec, STRIPE_WEBHOOK_SECRET_TEST: whsec } as unknown as NodeJS.ProcessEnv)).toEqual({
      secretKey: restricted,
      webhookSecret: whsec,
      webhookSecretTest: whsec,
    });
  });
  it("ignores a malformed signing secret instead of trusting it", () => {
    expect(getStripeConfig({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: "secret" } as unknown as NodeJS.ProcessEnv)?.webhookSecret).toBeNull();
  });
});

describe("getPagespeedKey", () => {
  it("returns a plausible key and null otherwise", () => {
    expect(getPagespeedKey({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getPagespeedKey({ PAGESPEED_API_KEY: "short" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getPagespeedKey({ PAGESPEED_API_KEY: ` ${"A".repeat(39)} ` } as unknown as NodeJS.ProcessEnv)).toBe("A".repeat(39));
  });
});

describe("getStripeInvoiceKey", () => {
  it("accepts a secret or restricted key and is null otherwise", () => {
    expect(getStripeInvoiceKey({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getStripeInvoiceKey({ STRIPE_INVOICE_KEY: "pk_live_publishable1234567890" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    const rk = `rk_live_${"q".repeat(24)}`;
    expect(getStripeInvoiceKey({ STRIPE_INVOICE_KEY: ` ${rk} ` } as unknown as NodeJS.ProcessEnv)).toBe(rk);
  });
});
