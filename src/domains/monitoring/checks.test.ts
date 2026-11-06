import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicTarget,
  BlockedTargetError,
  checkBrokenLinks,
  checkDomainExpiry,
  checkHttp,
  checkSsl,
  fetchPublic,
  MAX_HTML_BYTES,
  MAX_REDIRECTS,
  resetRdapCache,
  RETRY_DELAY_MS,
  scanUrl,
  type ScanDeps,
} from "./checks";

const PUBLIC_IP = "93.184.216.34";
const GOOD_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'self'",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=63072000",
  "x-content-type-options": "nosniff",
  server: "Vercel",
};

const html = (body = "<html><body>hi</body></html>", status = 200, headers: Record<string, string> = GOOD_HEADERS) => new Response(body, { status, headers });
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

/** Deps with a public-only DNS, an instant sleep and a clock that advances 10 ms per read. */
function makeDeps(over: Partial<ScanDeps> = {}): ScanDeps & { sleep: ReturnType<typeof vi.fn> } {
  let t = 0;
  return {
    fetchImpl: vi.fn(async () => html()) as unknown as typeof fetch,
    lookup: vi.fn(async () => [{ address: PUBLIC_IP }]),
    tlsConnect: vi.fn(async () => ({ validTo: "Jan  1 00:00:00 2027 GMT" })),
    sleep: vi.fn(async () => {}),
    now: () => (t += 10),
    ...over,
  } as ScanDeps & { sleep: ReturnType<typeof vi.fn> };
}

/** Responses in order; the last one repeats. */
function sequence(...responses: (Response | Error)[]) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetRdapCache();
});

describe("assertPublicTarget", () => {
  const deps = () => makeDeps();
  it("accepts a public http or https address and returns the checked addresses", async () => {
    const r = await assertPublicTarget("https://acme.com/x", deps());
    expect(r.url.hostname).toBe("acme.com");
    expect(r.addresses).toEqual([PUBLIC_IP]);
    await expect(assertPublicTarget("http://acme.com", deps())).resolves.toBeTruthy();
  });
  it.each([
    "file:///etc/passwd",
    "ftp://acme.com/",
    "gopher://acme.com/",
    "javascript:alert(1)",
    "not a url",
    "https://user:pass@acme.com/",
    "https://user@acme.com/",
    "http://localhost/",
    "http://LOCALHOST:8080/",
    "http://app.localhost/",
    "http://printer.local/",
    "http://db.internal/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]/",
    "http://0.0.0.0/",
  ])("refuses %s", async (url) => {
    await expect(assertPublicTarget(url, deps())).rejects.toBeInstanceOf(BlockedTargetError);
  });
  it("refuses a name that resolves to a private address", async () => {
    await expect(assertPublicTarget("https://evil.com/", makeDeps({ lookup: async () => [{ address: "10.0.0.5" }] }))).rejects.toThrow(/private or local/);
  });
  it("refuses a name when ANY of its addresses is private", async () => {
    await expect(assertPublicTarget("https://evil.com/", makeDeps({ lookup: async () => [{ address: PUBLIC_IP }, { address: "169.254.169.254" }] }))).rejects.toBeInstanceOf(BlockedTargetError);
  });
  it("refuses a name that does not resolve, or whose lookup fails", async () => {
    await expect(assertPublicTarget("https://acme.com/", makeDeps({ lookup: async () => [] }))).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicTarget("https://acme.com/", makeDeps({ lookup: async () => Promise.reject(new Error("ENOTFOUND")) }))).rejects.toBeInstanceOf(BlockedTargetError);
  });
  it("accepts a public IP written as an address, without a lookup", async () => {
    const d = makeDeps();
    const r = await assertPublicTarget("https://93.184.216.34/", d);
    expect(r.addresses).toEqual(["93.184.216.34"]);
    expect(d.lookup).not.toHaveBeenCalled();
  });
});

describe("fetchPublic", () => {
  it("refuses a redirect to a private address and never fetches it", async () => {
    const fetchImpl = sequence(redirect("http://169.254.169.254/latest/meta-data/"));
    await expect(fetchPublic("https://acme.com/", {}, makeDeps({ fetchImpl }))).rejects.toBeInstanceOf(BlockedTargetError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("refuses a redirect to a name that resolves to a private address", async () => {
    const lookup = vi.fn(async (host: string) => [{ address: host === "evil.com" ? "10.1.1.1" : PUBLIC_IP }]);
    const fetchImpl = sequence(redirect("https://evil.com/"));
    await expect(fetchPublic("https://acme.com/", {}, makeDeps({ fetchImpl, lookup }))).rejects.toBeInstanceOf(BlockedTargetError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("follows redirects (relative ones too) to the final page", async () => {
    const fetchImpl = sequence(redirect("https://www.acme.com/", 301), redirect("/home", 307), html("final"));
    const { res, finalUrl } = await fetchPublic("https://acme.com/", {}, makeDeps({ fetchImpl }));
    expect(finalUrl).toBe("https://www.acme.com/home");
    expect(await res.text()).toBe("final");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("stops a redirect loop after MAX_REDIRECTS hops", async () => {
    const fetchImpl = sequence(redirect("https://acme.com/loop"));
    await expect(fetchPublic("https://acme.com/", {}, makeDeps({ fetchImpl }))).rejects.toThrow(/Too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });
  it("hands redirects to the guard by hand (redirect: manual) and sends the monitor's user agent", async () => {
    const fetchImpl = sequence(html());
    await fetchPublic("https://acme.com/", { headers: { Accept: "text/html" } }, makeDeps({ fetchImpl }));
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({ "User-Agent": "LuminateOS-SiteMonitor/1.0", Accept: "text/html" });
  });
  it("returns a 3xx without a Location header as the answer", async () => {
    const fetchImpl = sequence(new Response(null, { status: 302 }));
    const { res } = await fetchPublic("https://acme.com/", {}, makeDeps({ fetchImpl }));
    expect(res.status).toBe(302);
  });
});

describe("checkHttp", () => {
  it("scores a healthy site and returns its HTML", async () => {
    const r = await checkHttp("https://acme.com/", makeDeps({ fetchImpl: sequence(html("<html>ok</html>")) }));
    expect(r).toMatchObject({ status: "up", httpStatus: 200, securityScore: 8, securityIssues: [], error: null, html: "<html>ok</html>" });
    expect(r.responseTimeMs).toBeGreaterThanOrEqual(0);
  });
  it("retries once after a 500: 500 then 200 is up", async () => {
    const fetchImpl = sequence(html("err", 500), html("fine"));
    const deps = makeDeps({ fetchImpl });
    const r = await checkHttp("https://acme.com/", deps);
    expect(r).toMatchObject({ status: "up", httpStatus: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledWith(RETRY_DELAY_MS);
  });
  it("two 500s in a row is down, with the real status", async () => {
    const fetchImpl = sequence(html("err", 500), html("err", 503));
    const r = await checkHttp("https://acme.com/", makeDeps({ fetchImpl }));
    expect(r).toMatchObject({ status: "down", httpStatus: 503, error: null });
    expect(r.securityIssues).toContain("Site returned HTTP 503");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("a 404 is an answer: down, and no retry", async () => {
    const fetchImpl = sequence(html("nope", 404));
    const deps = makeDeps({ fetchImpl });
    const r = await checkHttp("https://acme.com/", deps);
    expect(r).toMatchObject({ status: "down", httpStatus: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });
  it("retries once after a network error: error then 200 is up", async () => {
    const fetchImpl = sequence(new Error("ECONNRESET"), html());
    const r = await checkHttp("https://acme.com/", makeDeps({ fetchImpl }));
    expect(r).toMatchObject({ status: "up", httpStatus: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("two network errors is unreachable, with the last error and the old placeholder values", async () => {
    const fetchImpl = sequence(new Error("first"), new Error("connect ETIMEDOUT"));
    const r = await checkHttp("https://acme.com/", makeDeps({ fetchImpl }));
    expect(r).toEqual({
      status: "down",
      responseTimeMs: null,
      httpStatus: null,
      securityScore: 0,
      securityIssues: ["Site unreachable or SSL certificate invalid"],
      error: "connect ETIMEDOUT",
      html: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("does not retry a blocked address", async () => {
    const fetchImpl = sequence(html());
    const deps = makeDeps({ fetchImpl, lookup: async () => [{ address: "10.0.0.1" }] });
    const r = await checkHttp("https://intranet.example.com/", deps);
    expect(r.status).toBe("down");
    expect(r.error).toMatch(/^Blocked:/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
  });
  it("reads HTML only for text/html", async () => {
    const r = await checkHttp("https://acme.com/", makeDeps({ fetchImpl: sequence(html('{"a":1}', 200, { ...GOOD_HEADERS, "content-type": "application/json" })) }));
    expect(r.html).toBeNull();
    expect(r.status).toBe("up");
  });
  it("cuts a huge page at 1 MB instead of failing", async () => {
    const big = "a".repeat(MAX_HTML_BYTES * 2);
    const r = await checkHttp("https://acme.com/", makeDeps({ fetchImpl: sequence(html(big)) }));
    expect(r.status).toBe("up");
    expect(r.html).not.toBeNull();
    expect(r.html!.length).toBeLessThanOrEqual(MAX_HTML_BYTES);
    expect(r.html!.length).toBeGreaterThan(MAX_HTML_BYTES - 1000);
  });
  it("scores the security headers", async () => {
    const r = await checkHttp("https://acme.com/", makeDeps({ fetchImpl: sequence(html("x", 200, { "content-type": "text/html", server: "nginx/1.18.0" })) }));
    expect(r.securityScore).toBe(3); // 2xx, fast, https
    expect(r.securityIssues).toHaveLength(5);
  });
  it("scores http:// as not using https", async () => {
    const r = await checkHttp("http://acme.com/", makeDeps({ fetchImpl: sequence(html()) }));
    expect(r.securityIssues).toContain("Site does not use HTTPS");
  });
});

describe("a stalled page body", () => {
  it("cannot hang the scan: the read gives up at the deadline and keeps what arrived", async () => {
    vi.useFakeTimers();
    try {
      const stalled = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<html><body>partial"));
          },
          pull: () => new Promise(() => {}),
        }),
        { status: 200, headers: { "content-type": "text/html" } },
      );
      const deps = makeDeps({ fetchImpl: vi.fn(async () => stalled) as unknown as typeof fetch });
      const run = checkHttp("https://acme.com", deps);
      await vi.advanceTimersByTimeAsync(12_000);
      const r = await run;
      expect(r.httpStatus).toBe(200);
      expect(r.html).toContain("partial");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checkSsl", () => {
  it("returns the certificate expiry as an ISO time, connecting to the checked address with the right server name", async () => {
    const deps = makeDeps();
    const r = await checkSsl("acme.com", deps);
    expect(r).toEqual({ expiresAt: "2027-01-01T00:00:00.000Z", failure: null });
    expect(deps.tlsConnect).toHaveBeenCalledWith({ address: PUBLIC_IP, port: 443, servername: "acme.com", timeoutMs: 4_000 });
  });
  it("tries IPv4 before IPv6, so a server without IPv6 routing still reads the certificate", async () => {
    const v6 = "2606:2800:220:1:248:1893:25c8:1946";
    const deps = makeDeps({ lookup: vi.fn(async () => [{ address: v6 }, { address: PUBLIC_IP }]) });
    expect(await checkSsl("acme.com", deps)).toEqual({ expiresAt: "2027-01-01T00:00:00.000Z", failure: null });
    expect(deps.tlsConnect).toHaveBeenCalledTimes(1);
    expect(deps.tlsConnect).toHaveBeenCalledWith(expect.objectContaining({ address: PUBLIC_IP }));
  });
  it("tries the next address when one cannot be reached", async () => {
    const v6 = "2606:2800:220:1:248:1893:25c8:1946";
    let call = 0;
    const deps = makeDeps({
      lookup: vi.fn(async () => [{ address: PUBLIC_IP }, { address: v6 }]),
      tlsConnect: vi.fn(async () => {
        if (call++ === 0) throw new Error("connect ENETUNREACH");
        return { validTo: "Jan  1 00:00:00 2027 GMT" };
      }),
    });
    expect(await checkSsl("acme.com", deps)).toEqual({ expiresAt: "2027-01-01T00:00:00.000Z", failure: null });
    expect(deps.tlsConnect).toHaveBeenCalledTimes(2);
  });
  it("does not retry another address for a certificate problem, which is the same everywhere", async () => {
    const v6 = "2606:2800:220:1:248:1893:25c8:1946";
    const deps = makeDeps({
      lookup: vi.fn(async () => [{ address: PUBLIC_IP }, { address: v6 }]),
      tlsConnect: vi.fn(async () => Promise.reject(new Error("certificate has expired"))),
    });
    expect(await checkSsl("acme.com", deps)).toEqual({ expiresAt: null, failure: "SSL check failed: certificate has expired" });
    expect(deps.tlsConnect).toHaveBeenCalledTimes(1);
  });
  it("reports a certificate it could not read", async () => {
    expect(await checkSsl("acme.com", makeDeps({ tlsConnect: async () => ({ validTo: null }) }))).toEqual({ expiresAt: null, failure: "Could not read SSL certificate" });
    expect(await checkSsl("acme.com", makeDeps({ tlsConnect: async () => ({ validTo: "garbage" }) }))).toEqual({ expiresAt: null, failure: "Could not read SSL certificate" });
  });
  it("never throws: a connection error or timeout becomes a failure message", async () => {
    expect(await checkSsl("acme.com", makeDeps({ tlsConnect: async () => Promise.reject(new Error("certificate has expired")) }))).toEqual({
      expiresAt: null,
      failure: "SSL check failed: certificate has expired",
    });
    expect(await checkSsl("acme.com", makeDeps({ tlsConnect: async () => Promise.reject(new Error("timed out")) }))).toEqual({ expiresAt: null, failure: "SSL check timed out" });
  });
  it("refuses a private address without connecting", async () => {
    const deps = makeDeps({ lookup: async () => [{ address: "192.168.1.5" }] });
    const r = await checkSsl("intranet.example.com", deps);
    expect(r.expiresAt).toBeNull();
    expect(r.failure).toMatch(/Blocked/);
    expect(deps.tlsConnect).not.toHaveBeenCalled();
  });
});

describe("checkDomainExpiry", () => {
  const bootstrap = { services: [[["com", "net"], ["https://rdap.verisign.com/com/v1/"]], [["org"], ["https://rdap.publicinterestregistry.org/rdap/"]]] };
  const rdap = (date: string) => ({ events: [{ eventAction: "registration", eventDate: "2001-01-01T00:00:00Z" }, { eventAction: "expiration", eventDate: date }] });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const routed = (routes: Record<string, () => Response | Promise<Response>>) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
      if (!route) throw new Error(`unexpected fetch ${url}`);
      return route[1]();
    }) as unknown as typeof fetch;

  it("asks the registry named in IANA's bootstrap file and reads the expiration event", async () => {
    const fetchImpl = routed({
      "https://data.iana.org/rdap/dns.json": () => json(bootstrap),
      "https://rdap.verisign.com/com/v1/domain/acme.com": () => json(rdap("2027-03-04T05:06:07Z")),
    });
    expect(await checkDomainExpiry("www.acme.com", makeDeps({ fetchImpl }))).toBe("2027-03-04T05:06:07.000Z");
  });
  it("adds a missing trailing slash to the registry address and asks for RDAP JSON", async () => {
    const fetchImpl = routed({
      "https://data.iana.org/rdap/dns.json": () => json({ services: [[["org"], ["https://rdap.example.test/org"]]] }),
      "https://rdap.example.test/org/domain/acme.org": () => json(rdap("2027-01-01T00:00:00Z")),
    });
    expect(await checkDomainExpiry("acme.org", makeDeps({ fetchImpl }))).toBe("2027-01-01T00:00:00.000Z");
    const registryCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes("rdap.example.test"))!;
    expect((registryCall[1] as RequestInit).headers).toMatchObject({ Accept: expect.stringContaining("application/rdap+json") });
  });
  it("downloads the bootstrap file once and reuses it", async () => {
    const fetchImpl = routed({
      "https://data.iana.org/rdap/dns.json": () => json(bootstrap),
      "https://rdap.verisign.com/com/v1/domain/": () => json(rdap("2027-03-04T05:06:07Z")),
    });
    const deps = makeDeps({ fetchImpl });
    await checkDomainExpiry("acme.com", deps);
    await checkDomainExpiry("other.net", deps);
    const bootstrapCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).startsWith("https://data.iana.org"));
    expect(bootstrapCalls).toHaveLength(1);
  });
  it("falls back to rdap.org when the bootstrap file cannot be fetched", async () => {
    const fetchImpl = routed({
      "https://data.iana.org/rdap/dns.json": () => json({}, 500),
      "https://rdap.org/domain/acme.com": () => json(rdap("2027-06-01T00:00:00Z")),
    });
    expect(await checkDomainExpiry("acme.com", makeDeps({ fetchImpl }))).toBe("2027-06-01T00:00:00.000Z");
  });
  it("falls back to rdap.org when the bootstrap has no entry for the TLD", async () => {
    const fetchImpl = routed({
      "https://data.iana.org/rdap/dns.json": () => json(bootstrap),
      "https://rdap.org/domain/acme.xyz": () => json(rdap("2027-06-01T00:00:00Z")),
    });
    expect(await checkDomainExpiry("acme.xyz", makeDeps({ fetchImpl }))).toBe("2027-06-01T00:00:00.000Z");
  });
  it("falls back to rdap.org when the registry has no expiration event", async () => {
    const fetchImpl = routed({
      "https://data.iana.org/rdap/dns.json": () => json(bootstrap),
      "https://rdap.verisign.com/com/v1/domain/acme.com": () => json({ events: [{ eventAction: "registration", eventDate: "2001-01-01T00:00:00Z" }] }),
      "https://rdap.org/domain/acme.com": () => json(rdap("2027-09-09T00:00:00Z")),
    });
    expect(await checkDomainExpiry("acme.com", makeDeps({ fetchImpl }))).toBe("2027-09-09T00:00:00.000Z");
  });
  it("is null when nothing can be found, and never throws", async () => {
    const down = routed({ "https://": () => json({}, 500) });
    expect(await checkDomainExpiry("acme.com", makeDeps({ fetchImpl: down }))).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await checkDomainExpiry("acme.com", makeDeps({ fetchImpl: boom }))).toBeNull();
    const junk = routed({ "https://": () => new Response("not json", { status: 200 }) });
    expect(await checkDomainExpiry("acme.com", makeDeps({ fetchImpl: junk }))).toBeNull();
  });
  it("ignores an expiration date that is not a date", async () => {
    const fetchImpl = routed({
      "https://data.iana.org/rdap/dns.json": () => json(bootstrap),
      "https://rdap.verisign.com/com/v1/domain/": () => json(rdap("soon")),
      "https://rdap.org/domain/": () => json(rdap("also soon")),
    });
    expect(await checkDomainExpiry("acme.com", makeDeps({ fetchImpl }))).toBeNull();
  });
  it("does not look up IP addresses or single-label hosts", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await checkDomainExpiry("93.184.216.34", makeDeps({ fetchImpl }))).toBeNull();
    expect(await checkDomainExpiry("intranet", makeDeps({ fetchImpl }))).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("looks up the registrable domain, not the www host", async () => {
    const fetchImpl = routed({
      "https://data.iana.org/rdap/dns.json": () => json(bootstrap),
      "https://rdap.verisign.com/com/v1/domain/acme.com": () => json(rdap("2027-03-04T05:06:07Z")),
    });
    await checkDomainExpiry("www.shop.acme.com", makeDeps({ fetchImpl }));
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("https://rdap.verisign.com/com/v1/domain/acme.com");
  });
});

describe("checkBrokenLinks", () => {
  const page = '<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a><a href="https://other.com/x">x</a>';
  it("counts links that fail, with HEAD first and a GET fallback on 405", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method} ${url}`);
      if (url.endsWith("/a")) return new Response(null, { status: 200 });
      if (url.endsWith("/b")) return new Response(null, { status: 404 });
      if (url.endsWith("/c")) return new Response(null, { status: init?.method === "HEAD" ? 405 : 200 });
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const r = await checkBrokenLinks("https://acme.com/", page, makeDeps({ fetchImpl }));
    expect(r.checked).toBe(4);
    expect(r.brokenCount).toBe(2);
    expect(r.brokenUrls.sort()).toEqual(["https://acme.com/b", "https://acme.com/d"]);
    expect(calls).toContain("HEAD https://acme.com/c");
    expect(calls).toContain("GET https://acme.com/c");
    expect(calls.some((c) => c.includes("other.com"))).toBe(false);
  });
  it("checks nothing for a page without links", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await checkBrokenLinks("https://acme.com/", "<html>none</html>", makeDeps({ fetchImpl }))).toEqual({ checked: 0, brokenCount: 0, brokenUrls: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("skips links it has no time for instead of calling them broken", async () => {
    let t = 0;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    // Each clock read jumps 13 s, so after the first batch the 12 s budget is spent.
    const deps = makeDeps({ fetchImpl, now: () => (t += 13_000) });
    const many = Array.from({ length: 12 }, (_, i) => `<a href="/p${i}">p</a>`).join("");
    const r = await checkBrokenLinks("https://acme.com/", many, deps);
    expect(r.checked).toBeLessThan(12);
    expect(r.brokenCount).toBe(0);
  });
  it("does not follow a link that redirects to a private address", async () => {
    const fetchImpl = sequence(redirect("http://10.0.0.1/"));
    const r = await checkBrokenLinks("https://acme.com/", '<a href="/go">go</a>', makeDeps({ fetchImpl }));
    expect(r).toMatchObject({ checked: 1, brokenCount: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("scanUrl", () => {
  /** A fetch that answers the page, the IANA bootstrap, the registry and a link. */
  const siteFetch = (page: Response = html('<a href="/about">About</a>')) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://data.iana.org")) return new Response(JSON.stringify({ services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] }), { status: 200 });
      if (url.startsWith("https://rdap.verisign.com")) return new Response(JSON.stringify({ events: [{ eventAction: "expiration", eventDate: "2027-03-04T05:06:07Z" }] }), { status: 200 });
      if (url.endsWith("/about")) return new Response(null, { status: 200 });
      return page.clone();
    }) as unknown as typeof fetch;

  it("returns the whole picture of a healthy site", async () => {
    const r = await scanUrl("acme.com", makeDeps({ fetchImpl: siteFetch() }));
    expect(r).toEqual({
      status: "up",
      responseTimeMs: expect.any(Number),
      httpStatus: 200,
      securityScore: 8,
      securityIssues: [],
      error: null,
      sslExpiresAt: "2027-01-01T00:00:00.000Z",
      domainExpiresAt: "2027-03-04T05:06:07.000Z",
      brokenLinks: 0,
    });
  });
  it("adds https:// to a stored address that has no scheme", async () => {
    const fetchImpl = siteFetch();
    await scanUrl("acme.com", makeDeps({ fetchImpl }));
    const first = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(String(first)).toBe("https://acme.com");
  });
  it("skips the certificate check for an http:// site", async () => {
    const deps = makeDeps({ fetchImpl: siteFetch() });
    const r = await scanUrl("http://acme.com/", deps);
    expect(deps.tlsConnect).not.toHaveBeenCalled();
    expect(r.sslExpiresAt).toBeNull();
    expect(r.securityIssues).toContain("Site does not use HTTPS");
  });
  it("skips the link check when the page has no HTML, and reports null", async () => {
    const r = await scanUrl("https://acme.com/", makeDeps({ fetchImpl: siteFetch(html('{"ok":true}', 200, { ...GOOD_HEADERS, "content-type": "application/json" })) }));
    expect(r.brokenLinks).toBeNull();
    expect(r.status).toBe("up");
  });
  it("counts broken links", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://data.iana.org")) return new Response("{}", { status: 500 });
      if (url.startsWith("https://rdap.org")) return new Response("{}", { status: 404 });
      if (url.endsWith("/gone")) return new Response(null, { status: 404 });
      return html('<a href="/gone">x</a>');
    }) as unknown as typeof fetch;
    const r = await scanUrl("https://acme.com/", makeDeps({ fetchImpl }));
    expect(r.brokenLinks).toBe(1);
    expect(r.domainExpiresAt).toBeNull();
  });
  it("still reads the certificate and domain of a site that is down", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://data.iana.org")) return new Response(JSON.stringify({ services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] }), { status: 200 });
      if (url.startsWith("https://rdap.verisign.com")) return new Response(JSON.stringify({ events: [{ eventAction: "expiration", eventDate: "2027-03-04T05:06:07Z" }] }), { status: 200 });
      return html("down", 503);
    }) as unknown as typeof fetch;
    const r = await scanUrl("https://acme.com/", makeDeps({ fetchImpl }));
    expect(r).toMatchObject({ status: "down", httpStatus: 503, sslExpiresAt: "2027-01-01T00:00:00.000Z", domainExpiresAt: "2027-03-04T05:06:07.000Z" });
  });
  it("puts a certificate failure in the issues list, like the old app", async () => {
    const r = await scanUrl("https://acme.com/", makeDeps({ fetchImpl: siteFetch(), tlsConnect: async () => Promise.reject(new Error("socket hang up")) }));
    expect(r.sslExpiresAt).toBeNull();
    expect(r.securityIssues).toContain("SSL check failed: socket hang up");
  });
  it("never throws, whatever fails", async () => {
    const everythingFails: Partial<ScanDeps> = {
      fetchImpl: (() => {
        throw new Error("sync boom");
      }) as unknown as typeof fetch,
      lookup: async () => Promise.reject(new Error("dns boom")),
      tlsConnect: async () => Promise.reject(new Error("tls boom")),
      sleep: async () => {},
    };
    for (const url of ["https://acme.com/", "acme.com", "http://acme.com", "", "not a url at all", "http://[::1]/", "ftp://acme.com", "https://user:pw@acme.com"]) {
      const r = await scanUrl(url, everythingFails);
      expect(r.status).toBe("down");
      expect(r.securityScore).toBe(0);
      expect(r.error).not.toBeNull();
      expect(r.brokenLinks).toBeNull();
    }
  });
  it("treats a private address as down with a clear error, without calling it", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await scanUrl("http://169.254.169.254/", makeDeps({ fetchImpl }));
    expect(r).toMatchObject({ status: "down", error: expect.stringMatching(/^Blocked:/) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
