import { describe, expect, it } from "vitest";
import {
  buildMonitorRow,
  daysUntil,
  domainIssue,
  evaluateResponse,
  extractLinks,
  isBlockedHostname,
  isPublicAddress,
  looksLikeIp,
  registrableDomain,
  sslIssue,
  unreachable,
  withScheme,
} from "./scan-rules";
import type { ScanTarget, UrlScan } from "./scan-types";

const NOW = new Date("2026-11-06T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000 + 3_600_000).toISOString();

const GOOD_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=63072000",
  "x-content-type-options": "nosniff",
  server: "Vercel",
};
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const evaluate = (over: { url?: string; httpStatus?: number; responseTimeMs?: number; headers?: Record<string, string> } = {}) =>
  evaluateResponse({ url: over.url ?? "https://acme.com/", httpStatus: over.httpStatus ?? 200, responseTimeMs: over.responseTimeMs ?? 300, headers: headers(over.headers ?? GOOD_HEADERS) });

describe("withScheme", () => {
  it("adds https:// when there is no scheme and leaves a scheme alone", () => {
    expect(withScheme("acme.com")).toBe("https://acme.com");
    expect(withScheme("  acme.com/path ")).toBe("https://acme.com/path");
    expect(withScheme("http://acme.com")).toBe("http://acme.com");
    expect(withScheme("HTTPS://acme.com")).toBe("HTTPS://acme.com");
  });
});

describe("evaluateResponse: the 8 checks", () => {
  it("a healthy site passes all 8", () => {
    expect(evaluate()).toEqual({ status: "up", securityScore: 8, securityIssues: [] });
  });
  it.each([
    ["content-security-policy", "Missing Content-Security-Policy header"],
    ["x-frame-options", "Missing X-Frame-Options header (clickjacking risk)"],
    ["strict-transport-security", "Missing Strict-Transport-Security (HSTS) header"],
    ["x-content-type-options", "Missing X-Content-Type-Options header"],
  ])("a missing %s header costs one point with the old message", (name, message) => {
    const h = { ...GOOD_HEADERS };
    delete h[name];
    expect(evaluate({ headers: h })).toEqual({ status: "up", securityScore: 7, securityIssues: [message] });
  });
  it("not using https costs one point", () => {
    expect(evaluate({ url: "http://acme.com/" })).toEqual({ status: "up", securityScore: 7, securityIssues: ["Site does not use HTTPS"] });
  });
  it("a server header with a version, or any x-powered-by, is a leak", () => {
    expect(evaluate({ headers: { ...GOOD_HEADERS, server: "nginx/1.18.0" } }).securityIssues).toEqual(["Server header exposes version/framework info: nginx/1.18.0"]);
    expect(evaluate({ headers: { ...GOOD_HEADERS, "x-powered-by": "Express" } }).securityIssues).toEqual(["Server header exposes version/framework info: Vercel, Express"]);
    expect(evaluate({ headers: { ...GOOD_HEADERS, server: "nginx" } }).securityScore).toBe(8);
  });
  it("the score counts every failed check", () => {
    const r = evaluate({ url: "http://acme.com/", httpStatus: 500, responseTimeMs: 9000, headers: {} });
    expect(r.securityScore).toBe(1); // only "no version leak" passes
    expect(r.securityIssues).toHaveLength(7);
  });
});

describe("evaluateResponse: status thresholds", () => {
  it.each([
    [199, "down"],
    [200, "up"],
    [301, "up"],
    [399, "up"],
    [400, "down"],
    [404, "down"],
    [500, "down"],
  ])("HTTP %i is %s", (httpStatus, status) => {
    expect(evaluate({ httpStatus }).status).toBe(status);
  });
  it.each([
    [2999, "up"],
    [3000, "slow"],
  ])("a %i ms response is %s", (responseTimeMs, status) => {
    const r = evaluate({ responseTimeMs });
    expect(r.status).toBe(status);
    expect(r.securityIssues.includes("Slow response time (3000ms)")).toBe(responseTimeMs === 3000);
  });
  it("down wins over slow", () => {
    expect(evaluate({ httpStatus: 503, responseTimeMs: 9000 }).status).toBe("down");
  });
  it("a bad status adds the old message", () => {
    expect(evaluate({ httpStatus: 404 }).securityIssues).toEqual(["Site returned HTTP 404"]);
  });
});

describe("unreachable", () => {
  it("matches what the old app stored for a site that could not be reached", () => {
    expect(unreachable("fetch failed")).toEqual({
      status: "down",
      responseTimeMs: null,
      httpStatus: null,
      securityScore: 0,
      securityIssues: ["Site unreachable or SSL certificate invalid"],
      error: "fetch failed",
    });
  });
});

describe("registrableDomain", () => {
  it.each([
    ["acme.com", "acme.com"],
    ["www.acme.com", "acme.com"],
    ["shop.eu.acme.com", "acme.com"],
    ["acme.co.uk", "acme.co.uk"],
    ["www.acme.co.uk", "acme.co.uk"],
    ["WWW.Acme.COM.", "acme.com"],
    ["localhost", "localhost"],
  ])("%s -> %s", (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });
});

describe("extractLinks", () => {
  const base = "https://acme.com/";
  it("keeps same-host links, resolves relative ones, drops the rest", () => {
    const html = `
      <a href="/about">About</a>
      <a class="x" href='https://acme.com/contact'>Contact</a>
      <a href="https://other.com/x">Other</a>
      <a href="mailto:a@acme.com">Mail</a>
      <a href="tel:+18035550100">Call</a>
      <a href="javascript:void(0)">JS</a>
      <a href="#top">Top</a>
      <a href="ftp://acme.com/file">FTP</a>
      <a href="/about">About again</a>`;
    expect(extractLinks(html, base)).toEqual(["https://acme.com/about", "https://acme.com/contact"]);
  });
  it("stops at 25 links", () => {
    const html = Array.from({ length: 40 }, (_, i) => `<a href="/p${i}">p</a>`).join("");
    expect(extractLinks(html, base)).toHaveLength(25);
  });
  it("returns nothing for a bad base URL", () => {
    expect(extractLinks('<a href="/x">x</a>', "not a url")).toEqual([]);
  });
});

describe("daysUntil, sslIssue, domainIssue", () => {
  it("counts whole days, negative once passed, null for nothing or junk", () => {
    expect(daysUntil(inDays(7), NOW)).toBe(7);
    expect(daysUntil(new Date(NOW.getTime() - 30 * 3_600_000).toISOString(), NOW)).toBe(-2);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("junk", NOW)).toBeNull();
  });
  it("sslIssue warns at 14 days or fewer and when expired", () => {
    expect(sslIssue(null)).toBeNull();
    expect(sslIssue(15)).toBeNull();
    expect(sslIssue(14)).toBe("SSL certificate expires in 14 day(s)");
    expect(sslIssue(0)).toBe("SSL certificate expires in 0 day(s)");
    expect(sslIssue(-1)).toBe("SSL certificate has expired");
  });
  it("domainIssue warns at 30 days or fewer and when expired", () => {
    expect(domainIssue(31)).toBeNull();
    expect(domainIssue(30)).toBe("Domain expires in 30 day(s)");
    expect(domainIssue(-5)).toBe("Domain registration has expired");
  });
});

describe("buildMonitorRow", () => {
  const target: ScanTarget = { clientId: "c1", clientName: "Acme", url: "https://acme.com/" };
  const scan = (over: Partial<UrlScan> = {}): UrlScan => ({
    status: "up",
    responseTimeMs: 300,
    httpStatus: 200,
    securityScore: 8,
    securityIssues: [],
    error: null,
    sslExpiresAt: inDays(60),
    domainExpiresAt: inDays(200),
    brokenLinks: 0,
    ...over,
  });

  it("writes the exact columns the old app wrote, plus the history row", () => {
    const { monitor, check } = buildMonitorRow(target, scan(), null, NOW);
    expect(monitor).toEqual({
      client_id: "c1",
      url: "https://acme.com/",
      status: "up",
      response_time_ms: 300,
      http_status: 200,
      security_score: 8,
      security_issues: [],
      ssl_expires_at: inDays(60),
      domain_expires_at: inDays(200),
      broken_links_count: 0,
      last_checked_at: NOW.toISOString(),
      last_error: null,
    });
    expect(check).toEqual({ client_id: "c1", status: "up", response_time_ms: 300, security_score: 8, checked_at: NOW.toISOString() });
  });
  it("adds the certificate, domain and broken-link issues after the security issues", () => {
    const { monitor } = buildMonitorRow(target, scan({ securityIssues: ["Missing Content-Security-Policy header"], sslExpiresAt: inDays(5), domainExpiresAt: inDays(10), brokenLinks: 3 }), null, NOW);
    expect(monitor.security_issues).toEqual([
      "Missing Content-Security-Policy header",
      "SSL certificate expires in 5 day(s)",
      "Domain expires in 10 day(s)",
      "3 broken link(s) found on homepage",
    ]);
  });
  it("reports an expired certificate and domain", () => {
    const { monitor } = buildMonitorRow(target, scan({ sslExpiresAt: inDays(-3), domainExpiresAt: inDays(-3) }), null, NOW);
    expect(monitor.security_issues).toEqual(["SSL certificate has expired", "Domain registration has expired"]);
  });
  it("does not keep a known date that is already in the past after a failed lookup (no false \"expired\" after a renewal)", () => {
    const previous = { status: "up", sslExpiresAt: inDays(-5), domainExpiresAt: inDays(-5) };
    const { monitor } = buildMonitorRow(target, scan({ sslExpiresAt: null, domainExpiresAt: null, securityIssues: ["SSL check failed: connect ENETUNREACH"] }), previous, NOW);
    expect(monitor.ssl_expires_at).toBeNull();
    expect(monitor.domain_expires_at).toBeNull();
  });
  it("does keep a past certificate date when the failure really was an expired certificate", () => {
    const previous = { status: "up", sslExpiresAt: inDays(-1), domainExpiresAt: null };
    const { monitor } = buildMonitorRow(target, scan({ sslExpiresAt: null, securityIssues: ["SSL check failed: certificate has expired"] }), previous, NOW);
    expect(monitor.ssl_expires_at).toBe(inDays(-1));
  });
  it("keeps a known date when this scan's lookup failed (null), instead of erasing it", () => {
    const previous = { status: "up", sslExpiresAt: inDays(40), domainExpiresAt: inDays(300) };
    const { monitor } = buildMonitorRow(target, scan({ sslExpiresAt: null, domainExpiresAt: null }), previous, NOW);
    expect(monitor.ssl_expires_at).toBe(inDays(40));
    expect(monitor.domain_expires_at).toBe(inDays(300));
  });
  it("uses the new date when there is one, and null when there was never one", () => {
    const previous = { status: "up", sslExpiresAt: inDays(40), domainExpiresAt: null };
    expect(buildMonitorRow(target, scan({ sslExpiresAt: inDays(80) }), previous, NOW).monitor.ssl_expires_at).toBe(inDays(80));
    expect(buildMonitorRow(target, scan({ domainExpiresAt: null }), previous, NOW).monitor.domain_expires_at).toBeNull();
  });
  it("a kept date still raises its expiry issue", () => {
    const previous = { status: "up", sslExpiresAt: inDays(3), domainExpiresAt: null };
    const { monitor } = buildMonitorRow(target, scan({ sslExpiresAt: null, domainExpiresAt: null }), previous, NOW);
    expect(monitor.security_issues).toEqual(["SSL certificate expires in 3 day(s)"]);
  });
  it("a down site stores its error and a null broken-link count", () => {
    const down: UrlScan = { ...unreachable("fetch failed"), sslExpiresAt: null, domainExpiresAt: null, brokenLinks: null };
    const { monitor, check } = buildMonitorRow(target, down, null, NOW);
    expect(monitor).toMatchObject({ status: "down", response_time_ms: null, http_status: null, security_score: 0, last_error: "fetch failed", broken_links_count: null });
    expect(check).toMatchObject({ status: "down", security_score: 0 });
  });
});

describe("isBlockedHostname and looksLikeIp", () => {
  it.each(["localhost", "LOCALHOST", "app.localhost", "printer.local", "db.internal", "host.localdomain", "x.home.arpa", "", "localhost."])("%j is blocked", (h) => {
    expect(isBlockedHostname(h)).toBe(true);
  });
  it.each(["acme.com", "www.acme.co.uk", "internal.acme.com", "localhost.acme.com"])("%s is not blocked by name", (h) => {
    expect(isBlockedHostname(h)).toBe(false);
  });
  it("spots hosts written as IP addresses, including odd forms", () => {
    for (const h of ["127.0.0.1", "10.1.2.3", "2130706433", "::1", "2606:2800::1", "0177.0.0.1"]) expect(looksLikeIp(h)).toBe(true);
    for (const h of ["acme.com", "1password.com", "a1.b2.com"]) expect(looksLikeIp(h)).toBe(false);
  });
});

describe("isPublicAddress: IPv4", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.5",
    "192.0.2.1",
    "192.168.0.1",
    "192.168.255.255",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
  ])("%s is not public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(["93.184.216.34", "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "192.0.1.1", "198.17.255.255", "198.20.0.1", "223.255.255.254"])("%s is public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it("fails closed on anything that is not a clean address", () => {
    for (const ip of ["", "abc", "1.2.3", "1.2.3.4.5", "256.1.1.1", "010.0.0.1", "1.2.3.04", "127.1", "2130706433", "1.2.3.4%eth0", " ", "fe80::1%eth0"]) expect(isPublicAddress(ip)).toBe(false);
  });
  it("ignores surrounding space and brackets", () => {
    expect(isPublicAddress(" 93.184.216.34 ")).toBe(true);
    expect(isPublicAddress("[2606:2800:220:1:248:1893:25c8:1946]")).toBe(true);
    expect(isPublicAddress("[::1]")).toBe(false);
  });
});

describe("isPublicAddress: IPv6", () => {
  it("accepts ordinary public addresses", () => {
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(isPublicAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicAddress("2a00:1450:4001:81b::200e")).toBe(true);
    expect(isPublicAddress("3fff:1000::1")).toBe(true);
  });
  it.each([
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fdff:ffff::",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "ff00::",
    "2001:db8::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "100::1",
    "3fff::1",
    "3fff:fff:ffff::1",
    "4000::1",
    "8000::1",
  ])("%s is not public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it("judges IPv4-mapped addresses by the IPv4 inside them", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:169.254.169.254")).toBe(false);
    expect(isPublicAddress("::ffff:7f00:1")).toBe(false);
    expect(isPublicAddress("::ffff:192.168.1.1")).toBe(false);
    expect(isPublicAddress("0:0:0:0:0:ffff:a00:1")).toBe(false);
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
    expect(isPublicAddress("::ffff:5db8:d822")).toBe(true);
  });
  it("judges IPv4-compatible, NAT64 and 6to4 addresses by the IPv4 inside them", () => {
    expect(isPublicAddress("::127.0.0.1")).toBe(false);
    expect(isPublicAddress("::5db8:d822")).toBe(true);
    expect(isPublicAddress("64:ff9b::7f00:1")).toBe(false);
    expect(isPublicAddress("64:ff9b::5db8:d822")).toBe(true);
    expect(isPublicAddress("2002:7f00:1::")).toBe(false);
    expect(isPublicAddress("2002:5db8:d822::1")).toBe(true);
  });
  it("fails closed on malformed IPv6", () => {
    for (const ip of ["1::2::3", "12345::1", "g::1", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "::1.2.3", ":::"]) expect(isPublicAddress(ip)).toBe(false);
  });
});
