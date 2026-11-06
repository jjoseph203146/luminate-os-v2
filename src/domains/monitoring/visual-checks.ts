// Network side of the speed and visual check: one PageSpeed Insights call per site, and the screenshot comparison.
// Google's servers fetch the client site, not ours, so no address guard is needed here. Nothing in this file throws
// for a failed check, and the API key never appears in an error, a log line or a stored value.
import { decode } from "jpeg-js";
import { diffPercent, parsePagespeed, psiUrl, QUOTA_MESSAGE, redactKey, type PagespeedResult } from "./visual-rules";

export const PSI_TIMEOUT_MS = 40_000;

export interface VisualDeps {
  fetchImpl: typeof fetch;
}

const defaults = (deps?: Partial<VisualDeps>): VisualDeps => ({ fetchImpl: deps?.fetchImpl ?? ((input, init) => fetch(input, init)) });

const QUOTA_REASONS = /rateLimitExceeded|dailyLimitExceeded|userRateLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED/i;

/** Runs PageSpeed Insights (mobile, performance) for one site. Never throws. */
export async function runPagespeed(siteUrl: string, key: string | null, timeoutMs = PSI_TIMEOUT_MS, deps?: Partial<VisualDeps>): Promise<PagespeedResult> {
  const d = defaults(deps);
  let requestUrl: string;
  try {
    requestUrl = psiUrl(siteUrl, key);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The site address is not valid" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await d.fetchImpl(requestUrl, { signal: controller.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    // Only an error answer is searched for quota words: a normal Lighthouse report is large free text.
    if (res.status === 429 || (!res.ok && QUOTA_REASONS.test(text))) return { ok: false, error: QUOTA_MESSAGE };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: `PageSpeed Insights sent an unreadable answer (HTTP ${res.status})` };
    }
    const parsed = parsePagespeed(json);
    if (!res.ok && parsed.ok) return { ok: false, error: `PageSpeed Insights error (HTTP ${res.status})` };
    return parsed.ok ? parsed : { ok: false, error: redactKey(parsed.error, key) };
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, error: `PageSpeed Insights did not answer within ${Math.round(timeoutMs / 1000)} seconds` };
    return { ok: false, error: redactKey(`Could not reach PageSpeed Insights: ${e instanceof Error ? e.message : "unknown error"}`, key) };
  } finally {
    clearTimeout(timer);
  }
}

/** Decodes a JPEG to RGBA. Null when it is not a readable JPEG (or absurdly large). */
export function decodeJpeg(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } | null {
  try {
    const img = decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 8, maxMemoryUsageInMB: 128 });
    return img.width > 0 && img.height > 0 ? { width: img.width, height: img.height, data: img.data } : null;
  } catch {
    return null;
  }
}

/** How much of the page changed since the previous screenshot (0-100). Null with no previous image, or a different size. */
export function screenshotDiff(previous: Uint8Array | null, current: Uint8Array): number | null {
  if (!previous) return null;
  const a = decodeJpeg(previous);
  const b = decodeJpeg(current);
  if (!a || !b || a.width !== b.width || a.height !== b.height) return null;
  return diffPercent(a.data, b.data, a.width, a.height);
}
