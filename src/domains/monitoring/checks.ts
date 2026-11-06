// The site scanner's network checks: fetch a client's site, read its certificate, look up its domain
// registration, and test its homepage links. scanUrl() runs them all and NEVER throws.
// Everything that reaches out to an address stored in the database goes through the SSRF guard
// (assertPublicTarget), so a bad or malicious stored URL can never make the server call its own network.
// Dependencies (fetch, DNS, TLS, sleep, clock) can be injected, so the tests need no network.
import { lookup as dnsLookup } from "node:dns/promises";
import tls from "node:tls";
import {
  evaluateResponse,
  extractLinks,
  isBlockedHostname,
  isPublicAddress,
  looksLikeIp,
  registrableDomain,
  unreachable,
  withScheme,
  type ResponseEvaluation,
} from "./scan-rules";
import type { UrlScan } from "./scan-types";

const USER_AGENT = "LuminateOS-SiteMonitor/1.0";
export const MAIN_TIMEOUT_MS = 15_000;
/** The main page (both attempts, and the pause between them) gets at most this long in total. */
export const HTTP_PHASE_BUDGET_MS = 28_000;
export const RETRY_DELAY_MS = 2000;
export const MAX_REDIRECTS = 5;
export const MAX_HTML_BYTES = 1_048_576;
/** Per address; at most SSL_MAX_ADDRESSES are tried, so the whole certificate check stays near 12 seconds. */
const SSL_TIMEOUT_MS = 4_000;
const SSL_MAX_ADDRESSES = 3;
const RDAP_TIMEOUT_MS = 10_000;
/** The domain lookup as a whole (bootstrap, registry, fallback) stops here. */
const RDAP_TOTAL_MS = 12_000;
const LINK_TIMEOUT_MS = 8000;
/** No new link checks start after this long, so one slow site cannot hold up the whole scan. */
const LINKS_BUDGET_MS = 12_000;
const LINK_CONCURRENCY = 5;
const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const RDAP_BOOTSTRAP_TTL_MS = 24 * 3_600_000;

export interface TlsInfo {
  /** The certificate's valid_to text, e.g. "Jan  1 00:00:00 2027 GMT", or null when none was presented. */
  validTo: string | null;
}

export interface ScanDeps {
  fetchImpl: typeof fetch;
  /** Every address a name resolves to. */
  lookup: (host: string) => Promise<{ address: string }[]>;
  /** Opens a TLS connection to `address` and reads the peer certificate. Rejects on error or timeout. */
  tlsConnect: (opts: { address: string; port: number; servername: string; timeoutMs: number }) => Promise<TlsInfo>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

function defaultTlsConnect(opts: { address: string; port: number; servername: string; timeoutMs: number }): Promise<TlsInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: opts.address, port: opts.port, servername: opts.servername, timeout: opts.timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve({ validTo: cert && cert.valid_to ? cert.valid_to : null });
    });
    socket.on("error", (err) => reject(err));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("timed out"));
    });
  });
}

function withDefaults(deps: Partial<ScanDeps> | undefined): ScanDeps {
  return {
    fetchImpl: deps?.fetchImpl ?? ((input, init) => fetch(input, init)),
    lookup: deps?.lookup ?? (async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address }))),
    tlsConnect: deps?.tlsConnect ?? defaultTlsConnect,
    sleep: deps?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: deps?.now ?? (() => Date.now()),
  };
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : "unknown error");

// --- the SSRF guard ---------------------------------------------------------------------------

/** The scanner was asked to fetch something it must not (a private or local address, or a non-web URL). */
export class BlockedTargetError extends Error {
  constructor(reason: string) {
    super(`Blocked: ${reason}`);
    this.name = "BlockedTargetError";
  }
}

/**
 * Throws BlockedTargetError unless the URL is a plain http(s) address on the public internet: no credentials,
 * not localhost or an internal name, and every address it resolves to (or the IP it is written as) public.
 * Returns the parsed URL and the checked addresses.
 */
export async function assertPublicTarget(rawUrl: string, deps?: Partial<ScanDeps>): Promise<{ url: URL; addresses: string[] }> {
  const d = withDefaults(deps);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedTargetError("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedTargetError("only http and https addresses are allowed");
  if (url.username || url.password) throw new BlockedTargetError("addresses with a username or password are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host)) throw new BlockedTargetError("local and internal names are not allowed");

  if (looksLikeIp(host)) {
    if (!isPublicAddress(host)) throw new BlockedTargetError("private and local addresses are not allowed");
    return { url, addresses: [host] };
  }

  let resolved: { address: string }[];
  try {
    resolved = await d.lookup(host);
  } catch {
    throw new BlockedTargetError("the name could not be resolved");
  }
  if (resolved.length === 0) throw new BlockedTargetError("the name did not resolve");
  // Every address must be public: a name that also points at a private address is refused.
  if (resolved.some((a) => !isPublicAddress(a.address))) throw new BlockedTargetError("the name resolves to a private or local address");
  return { url, addresses: resolved.map((a) => a.address) };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Best effort: free the connection when the body is not going to be read. Never waits: a stuck connection must not hold up the scan. */
function discard(res: Response): void {
  try {
    void res.body?.cancel().catch(() => {});
  } catch {
    /* nothing to do */
  }
}

/**
 * fetch() that checks every hop. Redirects are followed by hand (at most MAX_REDIRECTS), and the guard runs
 * again on each new address, so a public site cannot redirect the scanner to a private one.
 * The timeout covers all hops until the response headers arrive.
 */
export async function fetchPublic(
  url: string,
  opts: { timeoutMs?: number; method?: string; headers?: Record<string, string> } = {},
  deps?: Partial<ScanDeps>,
): Promise<{ res: Response; finalUrl: string }> {
  const d = withDefaults(deps);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? MAIN_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      await assertPublicTarget(current, deps);
      const res = await d.fetchImpl(current, {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, ...opts.headers },
      });
      const location = res.headers.get("location");
      if (!REDIRECT_STATUSES.has(res.status) || !location) return { res, finalUrl: current };
      discard(res);
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      current = new URL(location, current).toString();
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Reads at most `maxBytes` of a text body, giving up after `timeoutMs`. A longer page is cut, not failed. */
async function readTextCapped(res: Response, maxBytes: number, timeoutMs: number, now: () => number): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const deadline = now() + timeoutMs;
  let received = 0;
  let text = "";
  try {
    while (received < maxBytes) {
      // Each read is raced against what is left of the time budget: a site that sends its headers and then
      // stalls must not be able to hang the scan (the deadline alone is only checked between reads).
      const remaining = deadline - now();
      if (remaining <= 0) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), remaining);
      });
      const next = await Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timer));
      if (next === null) break;
      const { done, value } = next;
      if (done) break;
      const room = maxBytes - received;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      received += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    return text === "" ? null : text;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

// --- the main page -----------------------------------------------------------------------------

export type HttpCheck = ResponseEvaluation & Pick<UrlScan, "responseTimeMs" | "httpStatus" | "error"> & { html: string | null };

/**
 * Fetches the site once, and once more after a short pause if the first try failed to connect or got a 5xx
 * (a single blip must not raise a "site down" alert). A 4xx is an answer, not a blip: no retry.
 */
export async function checkHttp(url: string, deps?: Partial<ScanDeps>): Promise<HttpCheck> {
  const d = withDefaults(deps);
  const phaseStart = d.now();
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const timeoutMs = attempt === 1 ? MAIN_TIMEOUT_MS : Math.max(3000, Math.min(MAIN_TIMEOUT_MS, HTTP_PHASE_BUDGET_MS - (d.now() - phaseStart)));
    const start = d.now();
    try {
      const { res } = await fetchPublic(url, { timeoutMs }, deps);
      const responseTimeMs = d.now() - start;
      if (res.status >= 500 && attempt === 1) {
        discard(res);
        await d.sleep(RETRY_DELAY_MS);
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const html = contentType.includes("text/html") ? await readTextCapped(res, MAX_HTML_BYTES, 10_000, d.now) : (discard(res), null);
      const evaluation = evaluateResponse({ url, httpStatus: res.status, responseTimeMs, headers: res.headers });
      return { ...evaluation, responseTimeMs, httpStatus: res.status, error: null, html };
    } catch (e) {
      lastError = messageOf(e);
      // A blocked address is a configuration problem, not a blip: retrying cannot help.
      if (e instanceof BlockedTargetError || attempt === 2) break;
      await d.sleep(RETRY_DELAY_MS);
    }
  }
  return { ...unreachable(lastError), html: null };
}

// --- certificate --------------------------------------------------------------------------------

export interface SslCheck {
  expiresAt: string | null;
  /** Why the certificate could not be read, in the old app's words; null when it was read. */
  failure: string | null;
}

/** Reads the SSL certificate's expiry. Never throws. Not for http:// sites: callers skip those. */
export async function checkSsl(hostname: string, deps?: Partial<ScanDeps>, port = 443): Promise<SslCheck> {
  const d = withDefaults(deps);
  try {
    const { addresses } = await assertPublicTarget(`https://${hostname}`, deps);
    if (addresses.length === 0) return { expiresAt: null, failure: "SSL check failed: the name did not resolve" };
    // IPv4 first: a server without IPv6 routing fails at once on an IPv6 address even though the site is fine.
    const ordered = [...addresses.filter((a) => !a.includes(":")), ...addresses.filter((a) => a.includes(":"))].slice(0, SSL_MAX_ADDRESSES);
    let failure = "SSL check failed";
    for (const address of ordered) {
      try {
        const info = await d.tlsConnect({ address, port, servername: hostname, timeoutMs: SSL_TIMEOUT_MS });
        const expires = info.validTo ? new Date(info.validTo) : null;
        if (!expires || Number.isNaN(expires.getTime())) return { expiresAt: null, failure: "Could not read SSL certificate" };
        return { expiresAt: expires.toISOString(), failure: null };
      } catch (e) {
        const message = messageOf(e);
        failure = /timed out/i.test(message) ? "SSL check timed out" : `SSL check failed: ${message}`;
        // A certificate problem is the same on every address: stop. A connection problem may be one address only: try the next.
        if (/certificate|self.signed|altnames|hostname/i.test(message)) break;
      }
    }
    return { expiresAt: null, failure };
  } catch (e) {
    return { expiresAt: null, failure: `SSL check failed: ${messageOf(e)}` };
  }
}

// --- domain registration -----------------------------------------------------------------------

let bootstrapCache: { at: number; services: [string[], string[]][] } | null = null;

/** For tests: forget the cached IANA bootstrap file. */
export function resetRdapCache(): void {
  bootstrapCache = null;
}

async function getJson(url: string, d: ScanDeps): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);
  try {
    const res = await d.fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/rdap+json, application/json", "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The registry's RDAP address for a top-level domain, from IANA's bootstrap file (cached for 24 hours). */
async function registryBase(tld: string, d: ScanDeps): Promise<string | null> {
  if (!bootstrapCache || d.now() - bootstrapCache.at > RDAP_BOOTSTRAP_TTL_MS) {
    const data = (await getJson(RDAP_BOOTSTRAP_URL, d)) as { services?: unknown } | null;
    if (!data || !Array.isArray(data.services)) return null;
    const services = (data.services as unknown[]).filter(
      (s): s is [string[], string[]] => Array.isArray(s) && Array.isArray(s[0]) && Array.isArray(s[1]),
    );
    bootstrapCache = { at: d.now(), services };
  }
  const entry = bootstrapCache.services.find(([tlds]) => tlds.some((t) => t.toLowerCase() === tld));
  const urls = entry?.[1] ?? [];
  const base = urls.find((u) => u.startsWith("https://")) ?? urls[0];
  if (!base) return null;
  return base.endsWith("/") ? base : `${base}/`;
}

function expirationOf(data: unknown): string | null {
  const events = (data as { events?: { eventAction?: unknown; eventDate?: unknown }[] } | null)?.events;
  if (!Array.isArray(events)) return null;
  const event = events.find((e) => typeof e?.eventAction === "string" && e.eventAction.toLowerCase() === "expiration");
  if (!event || typeof event.eventDate !== "string") return null;
  const t = Date.parse(event.eventDate);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function lookupDomain(domain: string, d: ScanDeps): Promise<string | null> {
  const tld = domain.split(".").pop() ?? "";
  try {
    const base = await registryBase(tld, d);
    if (base) {
      const iso = expirationOf(await getJson(`${base}domain/${domain}`, d));
      if (iso) return iso;
    }
  } catch {
    /* fall through to the public aggregator */
  }
  try {
    return expirationOf(await getJson(`https://rdap.org/domain/${domain}`, d));
  } catch {
    return null;
  }
}

/**
 * When the domain registration expires, from the registry's own RDAP service (found through IANA's bootstrap
 * file), falling back to rdap.org. Null when it cannot be found: many registries hide it. Never throws.
 */
export async function checkDomainExpiry(hostname: string, deps?: Partial<ScanDeps>): Promise<string | null> {
  const d = withDefaults(deps);
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || looksLikeIp(host)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), RDAP_TOTAL_MS);
    });
    return await Promise.race([lookupDomain(registrableDomain(host), d), limit]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- homepage links ----------------------------------------------------------------------------

export interface BrokenLinksCheck {
  checked: number;
  brokenCount: number;
  brokenUrls: string[];
}

async function linkWorks(link: string, timeoutMs: number, deps: Partial<ScanDeps> | undefined): Promise<boolean> {
  try {
    let { res } = await fetchPublic(link, { method: "HEAD", timeoutMs }, deps);
    // Some servers do not implement HEAD properly: ask again with GET.
    if (res.status === 405) {
      discard(res);
      ({ res } = await fetchPublic(link, { method: "GET", timeoutMs }, deps));
    }
    const ok = res.ok;
    discard(res);
    return ok;
  } catch {
    return false;
  }
}

/** Checks the homepage's own links (at most 25, five at a time). Links not reached within the time budget are skipped, not counted broken. */
export async function checkBrokenLinks(url: string, homepageHtml: string, deps?: Partial<ScanDeps>): Promise<BrokenLinksCheck> {
  const d = withDefaults(deps);
  const links = extractLinks(homepageHtml, url);
  const deadline = d.now() + LINKS_BUDGET_MS;
  const brokenUrls: string[] = [];
  let checked = 0;

  for (let i = 0; i < links.length; i += LINK_CONCURRENCY) {
    const remaining = deadline - d.now();
    if (remaining <= 0) break;
    const timeoutMs = Math.min(LINK_TIMEOUT_MS, remaining);
    const batch = links.slice(i, i + LINK_CONCURRENCY);
    const results = await Promise.all(batch.map(async (link) => ({ link, ok: await linkWorks(link, timeoutMs, deps) })));
    checked += batch.length;
    for (const r of results) if (!r.ok) brokenUrls.push(r.link);
  }
  return { checked, brokenCount: brokenUrls.length, brokenUrls };
}

// --- the whole scan ---------------------------------------------------------------------------

/** Settles to a value or the fallback, whatever happens. */
async function safely<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

/**
 * Everything about one site in one go: the page (with security checks), its certificate, its domain
 * registration and its homepage links. NEVER throws: a site that cannot be reached is a result ("down").
 * Worst case about 40 seconds (page 28 s at most, then the rest in parallel for at most 12 s); the scan job
 * puts a harder cap on each site (see service.ts).
 */
export async function scanUrl(rawUrl: string, deps?: Partial<ScanDeps>): Promise<UrlScan> {
  try {
    const url = withScheme(rawUrl);
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const http = await checkHttp(url, deps);
    const isHttps = url.startsWith("https://");

    const [ssl, domainExpiresAt, links] = await Promise.all([
      isHttps ? safely(checkSsl(hostname, deps, parsed.port ? Number(parsed.port) : 443), { expiresAt: null, failure: null }) : Promise.resolve(null),
      safely(checkDomainExpiry(hostname, deps), null),
      http.html !== null ? safely(checkBrokenLinks(url, http.html, deps), null) : Promise.resolve(null),
    ]);

    const securityIssues = [...http.securityIssues];
    if (ssl?.failure) securityIssues.push(ssl.failure);
    return {
      status: http.status,
      responseTimeMs: http.responseTimeMs,
      httpStatus: http.httpStatus,
      securityScore: http.securityScore,
      securityIssues,
      error: http.error,
      sslExpiresAt: ssl?.expiresAt ?? null,
      domainExpiresAt,
      brokenLinks: links ? links.brokenCount : null,
    };
  } catch (e) {
    return { ...unreachable(messageOf(e)), sslExpiresAt: null, domainExpiresAt: null, brokenLinks: null };
  }
}
