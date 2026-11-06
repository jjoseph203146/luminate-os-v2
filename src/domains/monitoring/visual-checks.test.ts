import { afterEach, describe, expect, it, vi } from "vitest";
import { encode } from "jpeg-js";
import { decodeJpeg, runPagespeed, screenshotDiff } from "./visual-checks";
import { QUOTA_MESSAGE } from "./visual-rules";

const KEY = "AIzaSyTESTKEY_secret_value_123";
const good = {
  lighthouseResult: {
    categories: { performance: { score: 0.91 } },
    audits: {
      "largest-contentful-paint": { numericValue: 1800 },
      "cumulative-layout-shift": { numericValue: 0.01 },
      "total-blocking-time": { numericValue: 90 },
      "final-screenshot": { details: { data: "data:image/jpeg;base64,QUJD" } },
    },
  },
};

const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

afterEach(() => vi.useRealTimers());

describe("runPagespeed", () => {
  it("returns the parsed result and sends the key and the site to PageSpeed Insights", async () => {
    const fetchImpl = respond(good);
    expect(await runPagespeed("https://acme.com", KEY, 40_000, { fetchImpl })).toEqual({ ok: true, score: 91, lcpMs: 1800, cls: 0.01, tbtMs: 90, screenshotBase64: "QUJD" });
    const url = new URL(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]));
    expect(url.hostname).toBe("www.googleapis.com");
    expect(url.searchParams.get("key")).toBe(KEY);
    expect(url.searchParams.get("url")).toBe("https://acme.com/");
  });
  it("turns HTTP 429 into the quota message", async () => {
    expect(await runPagespeed("https://acme.com", null, 40_000, { fetchImpl: respond({ error: { message: "Too many" } }, 429) })).toEqual({ ok: false, error: QUOTA_MESSAGE });
  });
  it("turns a quota error body into the quota message", async () => {
    const body = { error: { code: 403, message: "Quota exceeded", errors: [{ reason: "dailyLimitExceeded" }] } };
    expect(await runPagespeed("https://acme.com", KEY, 40_000, { fetchImpl: respond(body, 403) })).toEqual({ ok: false, error: QUOTA_MESSAGE });
  });
  it("does not mistake a normal report that mentions quota words for a quota error", async () => {
    const report = { ...good, note: "rateLimitExceeded appears in some page text" };
    expect((await runPagespeed("https://acme.com", null, 40_000, { fetchImpl: respond(report) })).ok).toBe(true);
  });
  it("reports an API error without the key, even if Google echoes it", async () => {
    const body = { error: { code: 400, message: `Bad request for key=${KEY}` } };
    const r = await runPagespeed("https://acme.com", KEY, 40_000, { fetchImpl: respond(body, 400) });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it("reports an unreadable answer", async () => {
    expect(await runPagespeed("https://acme.com", null, 40_000, { fetchImpl: respond("<html>oops</html>", 502) })).toEqual({ ok: false, error: "PageSpeed Insights sent an unreadable answer (HTTP 502)" });
  });
  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const run = runPagespeed("https://acme.com", KEY, 40_000, { fetchImpl });
    await vi.advanceTimersByTimeAsync(40_001);
    expect(await run).toEqual({ ok: false, error: "PageSpeed Insights did not answer within 40 seconds" });
  });
  it("never throws on a network error, and keeps the key out of the message", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      throw new Error(`connect failed for ${url}`);
    }) as unknown as typeof fetch;
    const r = await runPagespeed("https://acme.com", KEY, 40_000, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it("refuses a non-web address without calling Google", async () => {
    const fetchImpl = respond(good);
    expect(await runPagespeed("ftp://acme.com", null, 40_000, { fetchImpl })).toEqual({ ok: false, error: "Only http and https sites can be checked" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("screenshot comparison", () => {
  const jpeg = (w: number, h: number, colour: (x: number, y: number) => [number, number, number]) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = colour(x, y);
        data.set([r, g, b, 255], (y * w + x) * 4);
      }
    return new Uint8Array(encode({ data, width: w, height: h }, 95).data);
  };
  const grey = jpeg(16, 16, () => [128, 128, 128]);

  it("decodes a JPEG and refuses anything else", () => {
    expect(decodeJpeg(grey)).toMatchObject({ width: 16, height: 16 });
    expect(decodeJpeg(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("is null without a previous screenshot, or when the size changed", () => {
    expect(screenshotDiff(null, grey)).toBeNull();
    expect(screenshotDiff(jpeg(8, 8, () => [128, 128, 128]), grey)).toBeNull();
    expect(screenshotDiff(new Uint8Array([9, 9]), grey)).toBeNull();
  });
  it("is about 0 for the same picture and about half when half the page changed", () => {
    expect(screenshotDiff(grey, grey)).toBe(0);
    const halfWhite = jpeg(16, 16, (_x, y) => (y < 8 ? [255, 255, 255] : [128, 128, 128]));
    const d = screenshotDiff(grey, halfWhite);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(60);
  });
});
