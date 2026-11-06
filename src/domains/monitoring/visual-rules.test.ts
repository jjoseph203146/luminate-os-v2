import { describe, expect, it } from "vitest";
import {
  buildVisualErrorRow,
  buildVisualRow,
  diffPercent,
  MAX_SCREENSHOT_BASE64,
  parsePagespeed,
  pickDueSites,
  PSI_ENDPOINT,
  psiUrl,
  redactKey,
  screenshotPath,
  speedMessage,
} from "./visual-rules";
import type { ScanTarget } from "./scan-types";

const NOW = new Date("2026-11-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const KEY = "AIzaSyTESTKEY_abc123+/=";

function psi(over: { score?: unknown; lcp?: unknown; cls?: unknown; tbt?: unknown; shot?: unknown; runtimeError?: unknown } = {}) {
  return {
    lighthouseResult: {
      ...(over.runtimeError ? { runtimeError: over.runtimeError } : {}),
      categories: { performance: { score: "score" in over ? over.score : 0.873 } },
      audits: {
        "largest-contentful-paint": { numericValue: "lcp" in over ? over.lcp : 2143.7 },
        "cumulative-layout-shift": { numericValue: "cls" in over ? over.cls : 0.04567 },
        "total-blocking-time": { numericValue: "tbt" in over ? over.tbt : 151.2 },
        "final-screenshot": { details: { data: "shot" in over ? over.shot : "data:image/jpeg;base64,QUJD" } },
      },
    },
  };
}

describe("parsePagespeed", () => {
  it("reads the score, the three vitals and the screenshot", () => {
    expect(parsePagespeed(psi())).toEqual({ ok: true, score: 87, lcpMs: 2144, cls: 0.046, tbtMs: 151, screenshotBase64: "QUJD" });
  });
  it("accepts a perfect and a zero score", () => {
    expect(parsePagespeed(psi({ score: 1 }))).toMatchObject({ ok: true, score: 100 });
    expect(parsePagespeed(psi({ score: 0 }))).toMatchObject({ ok: true, score: 0 });
  });
  it("keeps the measurements when the screenshot is missing, not a JPEG, or too big", () => {
    expect(parsePagespeed(psi({ shot: undefined }))).toMatchObject({ ok: true, screenshotBase64: null });
    expect(parsePagespeed(psi({ shot: "data:image/png;base64,QUJD" }))).toMatchObject({ ok: true, screenshotBase64: null });
    expect(parsePagespeed(psi({ shot: `data:image/jpeg;base64,${"A".repeat(MAX_SCREENSHOT_BASE64 + 1)}` }))).toMatchObject({ ok: true, screenshotBase64: null });
  });
  it("reports Lighthouse's own runtime error", () => {
    const r = parsePagespeed(psi({ runtimeError: { code: "FAILED_DOCUMENT_REQUEST", message: "Lighthouse was unable to reliably load the page." } }));
    expect(r).toEqual({ ok: false, error: "Lighthouse could not test the page: Lighthouse was unable to reliably load the page." });
    expect(parsePagespeed(psi({ runtimeError: { code: "NO_ERROR" } })).ok).toBe(true);
  });
  it("reports an API error, a missing result, and malformed or missing values", () => {
    expect(parsePagespeed({ error: { code: 400, message: "Invalid value 'x'" } })).toEqual({ ok: false, error: "PageSpeed Insights error: Invalid value 'x'" });
    expect(parsePagespeed({})).toEqual({ ok: false, error: "PageSpeed Insights sent no Lighthouse result" });
    expect(parsePagespeed(null)).toMatchObject({ ok: false });
    expect(parsePagespeed([])).toMatchObject({ ok: false });
    expect(parsePagespeed(psi({ score: null }))).toEqual({ ok: false, error: "PageSpeed Insights sent no performance score" });
    expect(parsePagespeed(psi({ score: 1.5 }))).toMatchObject({ ok: false });
    expect(parsePagespeed(psi({ lcp: "fast" }))).toEqual({ ok: false, error: "PageSpeed Insights sent incomplete measurements" });
    expect(parsePagespeed(psi({ tbt: -1 }))).toMatchObject({ ok: false });
    expect(parsePagespeed(psi({ cls: Number.NaN }))).toMatchObject({ ok: false });
  });
});

describe("psiUrl and redactKey", () => {
  it("builds a mobile performance request with the site URL encoded", () => {
    const u = new URL(psiUrl("https://acme.com/a b?x=1&y=2", null));
    expect(`${u.origin}${u.pathname}`).toBe(PSI_ENDPOINT);
    expect(u.searchParams.get("url")).toBe("https://acme.com/a%20b?x=1&y=2");
    expect(u.searchParams.get("strategy")).toBe("mobile");
    expect(u.searchParams.get("category")).toBe("performance");
    expect(u.searchParams.has("key")).toBe(false);
  });
  it("adds the key only when there is one", () => {
    expect(new URL(psiUrl("https://acme.com", KEY)).searchParams.get("key")).toBe(KEY);
  });
  it("refuses anything but http and https, and junk", () => {
    expect(() => psiUrl("ftp://acme.com", null)).toThrow("Only http and https");
    expect(() => psiUrl("javascript:alert(1)", null)).toThrow();
    expect(() => psiUrl("not a url", null)).toThrow("not a valid URL");
  });
  it("removes the key, raw or URL-encoded, from any text", () => {
    const url = psiUrl("https://acme.com", KEY);
    expect(redactKey(`failed: ${url}`, KEY)).not.toContain(KEY);
    expect(redactKey(`failed: ${url}`, KEY)).not.toContain(encodeURIComponent(KEY));
    expect(redactKey(`key=${KEY} and ${encodeURIComponent(KEY)}`, KEY)).toBe("key=[key] and [key]");
    expect(redactKey("nothing secret", null)).toBe("nothing secret");
  });
});

describe("diffPercent", () => {
  const img = (pixels: number[][]) => Uint8Array.from(pixels.flatMap(([r = 0, g = 0, b = 0]) => [r, g, b, 255]));
  it("is 0 for identical images and 100 when every pixel changed", () => {
    const a = img([[10, 10, 10], [200, 200, 200]]);
    expect(diffPercent(a, a, 2, 1)).toBe(0);
    expect(diffPercent(a, img([[250, 10, 10], [0, 200, 200]]), 2, 1)).toBe(100);
  });
  it("ignores small changes (JPEG noise) and counts larger ones, on any channel", () => {
    const a = img([[100, 100, 100], [100, 100, 100], [100, 100, 100], [100, 100, 100]]);
    const b = img([[132, 100, 100], [100, 133, 100], [100, 100, 60], [100, 100, 100]]);
    // 32 is not more than the threshold; 33 and 40 are.
    expect(diffPercent(a, b, 2, 2)).toBe(50);
  });
  it("rounds to two decimals", () => {
    const a = img([[0], [0], [0]]);
    expect(diffPercent(a, img([[255], [0], [0]]), 3, 1)).toBe(33.33);
  });
  it("refuses data that does not match the size", () => {
    expect(() => diffPercent(new Uint8Array(4), new Uint8Array(8), 2, 1)).toThrow();
    expect(() => diffPercent(new Uint8Array(0), new Uint8Array(0), 0, 0)).toThrow();
  });
});

describe("pickDueSites", () => {
  const t = (id: string): ScanTarget => ({ clientId: id, clientName: `Client ${id}`, url: `https://${id}.com` });
  const targets = [t("a"), t("b"), t("c"), t("d")];
  it("takes never-checked sites first, then the oldest, and at most two", () => {
    const prev = [
      { clientId: "a", lastCheckedAt: hoursAgo(13) },
      { clientId: "b", lastCheckedAt: hoursAgo(20) },
      { clientId: "c", lastCheckedAt: null },
    ];
    expect(pickDueSites(targets, prev, NOW).map((x) => x.clientId)).toEqual(["c", "d"]);
    expect(pickDueSites(targets, prev, NOW, { maxPerRun: 4 }).map((x) => x.clientId)).toEqual(["c", "d", "b", "a"]);
  });
  it("skips sites checked within the last 12 hours", () => {
    const prev = targets.map((x) => ({ clientId: x.clientId, lastCheckedAt: hoursAgo(11.9) }));
    expect(pickDueSites(targets, prev, NOW)).toEqual([]);
    expect(pickDueSites(targets, [{ clientId: "a", lastCheckedAt: hoursAgo(12) }, ...prev.slice(1)], NOW).map((x) => x.clientId)).toEqual(["a"]);
  });
  it("respects a custom window and cap, and treats a bad date as never checked", () => {
    const prev = [{ clientId: "a", lastCheckedAt: "garbage" }, ...targets.slice(1).map((x) => ({ clientId: x.clientId, lastCheckedAt: hoursAgo(2) }))];
    expect(pickDueSites(targets, prev, NOW, { staleAfterHours: 1, maxPerRun: 1 }).map((x) => x.clientId)).toEqual(["a"]);
    expect(pickDueSites(targets, prev, NOW, { maxPerRun: 0 })).toEqual([]);
  });
});

describe("rows and messages", () => {
  const target: ScanTarget = { clientId: "c1", clientName: "Acme Bakery", url: "https://acme.com" };
  const at = new Date("2026-11-06T12:00:00Z");
  it("writes every column after a good check, as the old script did", () => {
    const row = buildVisualRow(target, { ok: true, score: 87, lcpMs: 2144, cls: 0.046, tbtMs: 151, screenshotBase64: "x" }, { path: screenshotPath("c1"), diff: 4.2 }, at);
    expect(row).toEqual({
      client_id: "c1",
      url: "https://acme.com",
      screenshot_path: "c1/latest.jpg",
      diff_percent: 4.2,
      lcp_ms: 2144,
      cls: 0.046,
      tbt_ms: 151,
      performance_score: 87,
      last_checked_at: "2026-11-06T12:00:00.000Z",
      last_error: null,
    });
  });
  it("writes only the error columns after a failure, so the last good numbers stay", () => {
    expect(buildVisualErrorRow(target, "boom", at)).toEqual({ client_id: "c1", url: "https://acme.com", last_checked_at: "2026-11-06T12:00:00.000Z", last_error: "boom" });
    expect(buildVisualErrorRow(target, "x".repeat(900), at).last_error).toHaveLength(500);
  });
  it("puts the client id first in the screenshot path (storage rules need it)", () => {
    expect(screenshotPath("abc")).toBe("abc/latest.jpg");
  });
  it("describes a result in one sentence", () => {
    expect(speedMessage({ clientName: "Acme", ok: true, score: 87, lcpMs: 2144, diff: null, error: null })).toBe("Acme: speed 87/100, largest content after 2.1 s.");
    expect(speedMessage({ clientName: "Acme", ok: true, score: 87, lcpMs: 2144, diff: 3.5, error: null })).toBe("Acme: speed 87/100, largest content after 2.1 s, 3.5% of the page changed since the last check.");
    expect(speedMessage({ clientName: "Acme", ok: false, score: null, lcpMs: null, diff: null, error: "Quota used up." })).toBe("Acme: the speed check failed. Quota used up.");
  });
});
