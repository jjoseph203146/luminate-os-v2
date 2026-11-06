// Pure rules for the site scanner: how a response is scored, which addresses are safe to fetch, and the
// row that is stored. No network, no database, no clock: `now` is always passed in. Ported from the old
// app's checkSite / checkSsl / checkDomainExpiry / checkBrokenLinks / runScan (same checks, same messages).
import { SECURITY_CHECK_TOTAL, type CheckRowInsert, type MonitorRowInsert, type PreviousMonitor, type ScanTarget, type UrlScan } from "./scan-types";

export const SLOW_THRESHOLD_MS = 3000;
/** Warn about an SSL certificate this many days before it expires. */
export const SSL_WARN_DAYS = 14;
/** Warn about a domain registration this many days before it expires. */
export const DOMAIN_WARN_DAYS = 30;
export const MAX_LINKS = 25;

const DAY_MS = 86_400_000;

/** Stored URLs are not always saved with a scheme ("example.com"): fetch would reject them and report a real site as down. */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// --- scoring a response (the 8 security checks) --------------------------------------------

export interface HeaderReader {
  get(name: string): string | null;
}

export type ResponseEvaluation = Pick<UrlScan, "status" | "securityScore" | "securityIssues">;

function leaksVersion(headerValue: string | null): boolean {
  return !!headerValue && /\d/.test(headerValue);
}

/** The old app's 8 checks, with its exact messages. `url` is the address that was requested. */
export function evaluateResponse(input: { url: string; httpStatus: number; responseTimeMs: number; headers: HeaderReader }): ResponseEvaluation {
  const { url, httpStatus, responseTimeMs, headers } = input;
  const issues: string[] = [];
  let passed = 0;

  if (httpStatus >= 200 && httpStatus < 400) passed++;
  else issues.push(`Site returned HTTP ${httpStatus}`);

  if (responseTimeMs < SLOW_THRESHOLD_MS) passed++;
  else issues.push(`Slow response time (${responseTimeMs}ms)`);

  if (url.startsWith("https://")) passed++;
  else issues.push("Site does not use HTTPS");

  if (headers.get("content-security-policy")) passed++;
  else issues.push("Missing Content-Security-Policy header");

  if (headers.get("x-frame-options")) passed++;
  else issues.push("Missing X-Frame-Options header (clickjacking risk)");

  if (headers.get("strict-transport-security")) passed++;
  else issues.push("Missing Strict-Transport-Security (HSTS) header");

  if (headers.get("x-content-type-options")) passed++;
  else issues.push("Missing X-Content-Type-Options header");

  const server = headers.get("server");
  const poweredBy = headers.get("x-powered-by");
  if (!leaksVersion(server) && !poweredBy) passed++;
  else issues.push(`Server header exposes version/framework info: ${[server, poweredBy].filter(Boolean).join(", ")}`);

  const status: UrlScan["status"] = httpStatus < 200 || httpStatus >= 400 ? "down" : responseTimeMs >= SLOW_THRESHOLD_MS ? "slow" : "up";
  return { status, securityScore: Math.min(passed, SECURITY_CHECK_TOTAL), securityIssues: issues };
}

/** What a site that could not be reached looks like (same as the old app). */
export function unreachable(errorMessage: string): Pick<UrlScan, "status" | "responseTimeMs" | "httpStatus" | "securityScore" | "securityIssues" | "error"> {
  return {
    status: "down",
    responseTimeMs: null,
    httpStatus: null,
    securityScore: 0,
    securityIssues: ["Site unreachable or SSL certificate invalid"],
    error: errorMessage,
  };
}

// --- domains, links, dates ---------------------------------------------------------------

// Common two-part public suffixes where the registrable domain is the last three labels. Not the full
// public suffix list, but covers the usual cases without a dependency.
const TWO_PART_SUFFIXES = new Set(["co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.za", "co.in", "com.br", "com.mx"]);

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join(".");
  return lastTwo;
}

/** Links on the homepage that stay on the same host: no mailto/tel/javascript, no duplicates, at most MAX_LINKS. */
export function extractLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const hrefs = [...html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)].map((m) => m[1] ?? "");
  const seen = new Set<string>();
  const links: string[] = [];
  for (const href of hrefs) {
    if (!href || /^(mailto|tel|javascript):/i.test(href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.hostname !== base.hostname) continue;
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    const key = resolved.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(key);
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

/** Whole days from `now` to `iso`: negative once passed, null when the date is missing or not a date. */
export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / DAY_MS);
}

export function sslIssue(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return "SSL certificate has expired";
  return days <= SSL_WARN_DAYS ? `SSL certificate expires in ${days} day(s)` : null;
}

export function domainIssue(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return "Domain registration has expired";
  return days <= DOMAIN_WARN_DAYS ? `Domain expires in ${days} day(s)` : null;
}

// --- the rows that are stored --------------------------------------------------------------

/**
 * The site_monitors row (upsert key: client_id) and the site_monitor_checks history row for one scan,
 * with the same columns the old app wrote. One improvement: when a certificate or domain lookup fails
 * (null) but a date was known before, the known date is kept, so a flaky lookup never erases an expiry.
 */
export function buildMonitorRow(target: ScanTarget, scan: UrlScan, previous: PreviousMonitor | null, checkedAt: Date): { monitor: MonitorRowInsert; check: CheckRowInsert } {
  // A failed lookup must not erase a known expiry, so the previous date is kept. But only while it is still in the
  // future: a stale past date kept forever would raise a false "expired" alert after a renewal whose lookup keeps
  // failing (for example an unreachable address). The exception is a certificate that really did expire: the
  // connection then fails with an "expired" error, and the past date is the truth.
  const stillAhead = (iso: string | null | undefined) => (iso ?? null) !== null && Date.parse(iso as string) > checkedAt.getTime();
  const sslExpired = scan.securityIssues.some((i) => /certificate has expired/i.test(i));
  const sslExpiresAt = scan.sslExpiresAt ?? (stillAhead(previous?.sslExpiresAt) || sslExpired ? (previous?.sslExpiresAt ?? null) : null);
  const domainExpiresAt = scan.domainExpiresAt ?? (stillAhead(previous?.domainExpiresAt) ? (previous?.domainExpiresAt ?? null) : null);

  const issues = [...scan.securityIssues];
  const ssl = sslIssue(daysUntil(sslExpiresAt, checkedAt));
  if (ssl) issues.push(ssl);
  const domain = domainIssue(daysUntil(domainExpiresAt, checkedAt));
  if (domain) issues.push(domain);
  if (scan.brokenLinks !== null && scan.brokenLinks > 0) issues.push(`${scan.brokenLinks} broken link(s) found on homepage`);

  const at = checkedAt.toISOString();
  return {
    monitor: {
      client_id: target.clientId,
      url: target.url,
      status: scan.status,
      response_time_ms: scan.responseTimeMs,
      http_status: scan.httpStatus,
      security_score: scan.securityScore,
      security_issues: issues,
      ssl_expires_at: sslExpiresAt,
      domain_expires_at: domainExpiresAt,
      broken_links_count: scan.brokenLinks,
      last_checked_at: at,
      last_error: scan.error,
    },
    check: {
      client_id: target.clientId,
      status: scan.status,
      response_time_ms: scan.responseTimeMs,
      security_score: scan.securityScore,
      checked_at: at,
    },
  };
}

// --- which addresses may be fetched (SSRF guard) --------------------------------------------
// The scanner fetches addresses stored in the database. It must never be turned into a way to reach the
// server's own network (localhost, private ranges, the cloud metadata address 169.254.169.254).

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];

/** Names that are never public hosts. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "" || h === "localhost") return true;
  return BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

/** A host that is written as an IP address (or looks like one), so it is judged by isPublicAddress, not looked up. */
export function looksLikeIp(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(":");
}

function parseIPv4(s: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const text = m[i] ?? "";
    // "010" is octal to some parsers and decimal to others: refuse the ambiguity.
    if (text.length > 1 && text.startsWith("0")) return null;
    const n = Number(text);
    if (n > 255) return null;
    parts.push(n);
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(s)) return null;
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const split = (part: string) => (part === "" ? [] : part.split(":"));
  const head = split(halves[0] ?? "");
  const tail = halves.length === 2 ? split(halves[1] ?? "") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  if (nums.length !== 8 || nums.some((n) => Number.isNaN(n))) return null;
  return nums;
}

function publicV4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return false; // "this" network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, incl. the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // protocol assignments, documentation
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function embeddedV4(hi: number, lo: number): [number, number, number, number] {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

function publicV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const zeroTo4 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (zeroTo4 && g5 === 0xffff) return publicV4(embeddedV4(g6, g7)); // IPv4-mapped ::ffff:a.b.c.d
  if (zeroTo4 && g5 === 0) return g6 === 0 && g7 <= 1 ? false : publicV4(embeddedV4(g6, g7)); // ::, ::1, IPv4-compatible
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return publicV4(embeddedV4(g6, g7)); // NAT64
  if (g0 === 0x2002) return publicV4(embeddedV4(g1, g2)); // 6to4
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return false; // Teredo, documentation
  if (g0 === 0x3fff && g1 < 0x1000) return false; // documentation (3fff::/20)
  // Only global unicast (2000::/3) is public; this also rules out unique-local (fc00::/7), link-local
  // (fe80::/10), site-local, multicast (ff00::/8) and everything else that is not a normal internet address.
  return (g0 & 0xe000) === 0x2000;
}

/** True only for an address on the public internet. Anything unparseable is NOT public (fails closed). */
export function isPublicAddress(address: string): boolean {
  const ip = address.trim().replace(/^\[|\]$/g, "");
  if (ip === "" || ip.includes("%")) return false;
  const v4 = parseIPv4(ip);
  if (v4) return publicV4(v4);
  const v6 = parseIPv6(ip);
  return v6 ? publicV6(v6) : false;
}
