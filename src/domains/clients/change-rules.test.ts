import { describe, expect, it } from "vitest";
import { flagMessage, monitoredAddress, nextFlagValue, normalizeWebsiteUrl, sameWebsite } from "./rules";
import { buildScanTargets } from "@/domains/monitoring/service";

describe("nextFlagValue", () => {
  it("stamps now when turning on, keeps the original date when already on, clears when turning off", () => {
    expect(nextFlagValue(null, true, "2026-11-06T00:00:00Z")).toBe("2026-11-06T00:00:00Z");
    expect(nextFlagValue("2026-01-01T00:00:00Z", true, "2026-11-06T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
    expect(nextFlagValue("2026-01-01T00:00:00Z", false, "2026-11-06T00:00:00Z")).toBeNull();
    expect(nextFlagValue(null, false, "2026-11-06T00:00:00Z")).toBeNull();
  });
  it("says whether anything changed", () => {
    expect(flagMessage("archived", true, true)).toContain("archived");
    expect(flagMessage("archived", true, false)).toBe("This client is already archived.");
    expect(flagMessage("monitoring_paused", false, false)).toBe("Monitoring is already on for this client.");
  });
});

describe("normalizeWebsiteUrl", () => {
  const ok = (raw: string) => {
    const r = normalizeWebsiteUrl(raw);
    if ("error" in r) throw new Error(r.error);
    return r.url;
  };
  const err = (raw: string) => {
    const r = normalizeWebsiteUrl(raw);
    return "error" in r ? r.error : null;
  };
  it("adds https:// to a bare domain, lowercases the host and drops a trailing slash", () => {
    expect(ok("Example.com")).toBe("https://example.com");
    expect(ok("  https://WWW.Example.com/ ")).toBe("https://www.example.com");
    expect(ok("https://example.com/shop/?a=1")).toBe("https://example.com/shop?a=1");
  });
  it("refuses http, other schemes, logins, IP addresses and hostnames without a dot", () => {
    expect(err("http://example.com")).toContain("https://");
    expect(err("ftp://example.com")).toContain("https://");
    expect(err("javascript://alert(1)")).toContain("https://");
    expect(err("https://user:pw@example.com")).toContain("login");
    expect(err("https://127.0.0.1")).toContain("domain");
    expect(err("localhost")).toContain("domain");
    expect(err("")).toBe("Enter a website address.");
    expect(err(`https://example.com/${"a".repeat(600)}`)).toContain("at most");
  });
});

describe("sameWebsite", () => {
  it("ignores scheme, www, case and a trailing slash", () => {
    expect(sameWebsite("https://www.Example.com/", "example.com")).toBe(true);
    expect(sameWebsite("https://example.com/shop", "https://example.com")).toBe(false);
  });
});

describe("monitoredAddress (same choice as the site scanner)", () => {
  const P = (id: string, productionUrl: string | null, createdAt: string) => ({ id, productionUrl, createdAt });
  const W = (id: string, url: string) => ({ id, url });

  it("prefers the oldest project's live address, then the oldest website", () => {
    expect(monitoredAddress([P("p2", "new.com", "2026-02-01"), P("p1", "https://old.com", "2026-01-01")], [W("w1", "site.com")])).toEqual({ url: "https://old.com", source: "project", id: "p1" });
    expect(monitoredAddress([P("p1", null, "2026-01-01")], [W("w1", "site.com"), W("w2", "two.com")])).toEqual({ url: "https://site.com", source: "website", id: "w1" });
    expect(monitoredAddress([], [])).toBeNull();
  });

  it("matches buildScanTargets for the same data", () => {
    const cases: { projects: ReturnType<typeof P>[]; websites: ReturnType<typeof W>[] }[] = [
      { projects: [P("p1", "https://a.com", "2026-01-01")], websites: [W("w1", "b.com")] },
      { projects: [P("p1", null, "2026-01-01")], websites: [W("w1", "b.com")] },
      { projects: [P("p1", "  ", "2026-01-01"), P("p2", "https://c.com", "2026-02-01")], websites: [W("w1", "b.com")] },
      { projects: [], websites: [W("w1", " "), W("w2", "d.com")] },
      { projects: [], websites: [] },
    ];
    for (const c of cases) {
      // What monitoring's repo hands the scanner: the oldest project with a non-null address, websites oldest first.
      const oldest = [...c.projects].filter((p) => p.productionUrl !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      const target = buildScanTargets([
        { clientId: "c", clientName: "C", archivedAt: null, monitoringPausedAt: null, projectUrl: oldest?.productionUrl ?? null, websiteUrls: c.websites.map((w) => w.url) },
      ])[0];
      expect(monitoredAddress(c.projects, c.websites)?.url ?? null).toBe(target?.url ?? null);
    }
  });
});
