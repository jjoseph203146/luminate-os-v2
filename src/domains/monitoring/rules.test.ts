import { describe, expect, it } from "vitest";
import { daysLeft, expiryBucket, hostOf, isStale, planAlerts } from "./rules";
import type { SiteMonitor } from "./types";

const NOW = new Date("2026-11-05T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000 + 3_600_000).toISOString();

const site = (over: Partial<SiteMonitor> = {}): SiteMonitor => ({
  id: "s1",
  clientId: "c1",
  clientName: "Acme Bakery",
  url: "https://www.acmebakery.com/",
  status: "up",
  responseTimeMs: 300,
  httpStatus: 200,
  securityScore: 90,
  brokenLinks: 0,
  sslExpiresAt: inDays(90),
  domainExpiresAt: inDays(200),
  lastCheckedAt: minsAgo(5),
  lastError: null,
  alertsMuted: false,
  ...over,
});

describe("helpers", () => {
  it("hostOf strips the scheme, path and www", () => {
    expect(hostOf("https://www.acmebakery.com/path")).toBe("acmebakery.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
  it("isStale: no check, or older than an hour", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(minsAgo(59), NOW)).toBe(false);
    expect(isStale(minsAgo(61), NOW)).toBe(true);
  });
  it("daysLeft counts whole days and is negative once passed", () => {
    expect(daysLeft(null, NOW)).toBeNull();
    expect(daysLeft("junk", NOW)).toBeNull();
    expect(daysLeft(inDays(7), NOW)).toBe(7);
    expect(daysLeft(minsAgo(60 * 30), NOW)).toBe(-2);
  });
  it("expiryBucket", () => {
    expect([null, 30, 15, 14, 8, 7, 4, 3, 2, 1, 0, -1].map(expiryBucket)).toEqual([null, null, null, 14, 14, 7, 7, 3, 3, 1, 1, 0]);
  });
});

describe("planAlerts: up and down", () => {
  it("a first-seen healthy site is recorded silently", () => {
    const plan = planAlerts([site()], [], NOW).filter((a) => a.key.endsWith(":status"));
    expect(plan).toEqual([{ key: "site:s1:status", state: "up", payload: null }]);
  });
  it("a site that goes down is announced once", () => {
    const down = site({ status: "down", httpStatus: 503, lastError: "Bad gateway" });
    const first = planAlerts([down], [{ key: "site:s1:status", state: "up" }], NOW).find((a) => a.key === "site:s1:status");
    expect(first?.payload?.title).toBe("Site down: Acme Bakery");
    expect(first?.payload?.body).toContain("acmebakery.com returned 503");
    expect(first?.state).toBe("down");
    const again = planAlerts([down], [{ key: "site:s1:status", state: "down" }], NOW).filter((a) => a.key === "site:s1:status");
    expect(again).toEqual([]);
  });
  it("a site first seen already down is announced", () => {
    const a = planAlerts([site({ status: "down" })], [], NOW).find((x) => x.key === "site:s1:status");
    expect(a?.payload?.title).toBe("Site down: Acme Bakery");
  });
  it("recovery is announced once, and slow counts as up", () => {
    const rec = planAlerts([site({ status: "slow" })], [{ key: "site:s1:status", state: "down" }], NOW).find((x) => x.key === "site:s1:status");
    expect(rec?.payload?.title).toBe("Back up: Acme Bakery");
    expect(rec?.state).toBe("up");
  });
  it("a stale check is not judged up or down", () => {
    const plan = planAlerts([site({ status: "down", lastCheckedAt: minsAgo(120) })], [{ key: "site:s1:status", state: "up" }], NOW);
    expect(plan.find((a) => a.key === "site:s1:status")).toBeUndefined();
  });
  it("unknown status is ignored", () => {
    expect(planAlerts([site({ status: "unknown" })], [], NOW).find((a) => a.key === "site:s1:status")).toBeUndefined();
  });
});

describe("planAlerts: expiry", () => {
  const ssl = (days: number, last?: string) =>
    planAlerts([site({ sslExpiresAt: inDays(days) })], [{ key: "site:s1:status", state: "up" }, ...(last ? [{ key: "site:s1:ssl", state: last }] : [])], NOW).find((a) => a.key === "site:s1:ssl");

  it("announces the first threshold crossed, with a sensible title", () => {
    const a = ssl(13);
    expect(a?.state).toBe("14");
    expect(a?.payload?.title).toBe("SSL expires in 13 days: Acme Bakery");
  });
  it("does not repeat a threshold, but announces the next one", () => {
    expect(ssl(12, "14")).toBeUndefined();
    expect(ssl(6, "14")?.state).toBe("7");
    expect(ssl(0, "3")?.state).toBe("1");
  });
  it("announces expired once", () => {
    const a = ssl(-2, "1");
    expect(a?.state).toBe("0");
    expect(a?.payload?.title).toBe("SSL certificate EXPIRED: Acme Bakery");
    expect(ssl(-3, "0")).toBeUndefined();
  });
  it("resets quietly after a renewal so the next cycle can alert again", () => {
    const a = ssl(90, "3");
    expect(a).toEqual({ key: "site:s1:ssl", state: "ok", payload: null });
  });
  it("works for the domain too", () => {
    const a = planAlerts([site({ domainExpiresAt: inDays(5) })], [], NOW).find((x) => x.key === "site:s1:domain");
    expect(a?.payload?.title).toBe("Domain expires in 5 days: Acme Bakery");
  });
});

describe("planAlerts: stalled checker", () => {
  it("alerts once when a site has not been checked for over an hour, then resets quietly", () => {
    const stale = [site({ lastCheckedAt: minsAgo(90) }), site({ id: "s2", lastCheckedAt: null })];
    const a = planAlerts(stale, [], NOW).find((x) => x.key === "monitoring:stalled");
    expect(a?.payload?.title).toBe("Site checks look stalled");
    expect(a?.payload?.body).toContain("2 sites have not been checked");
    expect(planAlerts(stale, [{ key: "monitoring:stalled", state: "stalled" }], NOW).find((x) => x.key === "monitoring:stalled")).toBeUndefined();
    const back = planAlerts([site()], [{ key: "monitoring:stalled", state: "stalled" }], NOW).find((x) => x.key === "monitoring:stalled");
    expect(back).toEqual({ key: "monitoring:stalled", state: "ok", payload: null });
  });
});

describe("planAlerts: muted sites (archived, on hold, monitoring stopped)", () => {
  const muted = (over: Partial<SiteMonitor> = {}) => site({ id: "m1", clientName: "Gone Co", alertsMuted: true, ...over });

  it("a muted site that is stale does not raise the stalled alert", () => {
    expect(planAlerts([site(), muted({ lastCheckedAt: minsAgo(60 * 24 * 30) })], [], NOW).find((a) => a.key === "monitoring:stalled")).toBeUndefined();
  });
  it("a muted stale site does not keep an existing stalled alert latched", () => {
    const plan = planAlerts([site(), muted({ lastCheckedAt: null })], [{ key: "monitoring:stalled", state: "stalled" }], NOW);
    expect(plan.find((a) => a.key === "monitoring:stalled")).toEqual({ key: "monitoring:stalled", state: "ok", payload: null });
  });
  it("a real stall on a watched site still alerts once, even with muted sites present", () => {
    const plan = planAlerts([site({ lastCheckedAt: minsAgo(90) }), muted({ lastCheckedAt: null })], [], NOW);
    const stalled = plan.find((a) => a.key === "monitoring:stalled");
    expect(stalled?.payload?.body).toContain("1 site has not been checked");
  });
  it("a muted site that is down, or near expiry, sends nothing and records nothing", () => {
    const m = muted({ status: "down", sslExpiresAt: inDays(2), domainExpiresAt: inDays(1) });
    expect(planAlerts([m], [{ key: "site:m1:status", state: "up" }], NOW)).toEqual([]);
  });
  it("a site that was down and is then muted stays quiet", () => {
    expect(planAlerts([muted({ status: "up" })], [{ key: "site:m1:status", state: "down" }], NOW)).toEqual([]);
  });
});
