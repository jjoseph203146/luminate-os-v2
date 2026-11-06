// Pure rules for the speed and visual check (the `visual_checks` job). No network, no clock reads: `now` is passed in.
// The check asks Google PageSpeed Insights (Lighthouse, mobile) about each site: a speed score, three Core Web
// Vitals and a screenshot. The screenshot is compared with the previous one to spot visual changes.
import type { Database } from "@/types/database";
import type { ScanTarget } from "./scan-types";

export const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
/** A screenshot larger than this (base64 characters) is refused. PSI screenshots are normally well under 200 KB. */
export const MAX_SCREENSHOT_BASE64 = 2 * 1024 * 1024;
/** A site is checked again once its last check is older than this. */
export const STALE_AFTER_HOURS = 12;
/** Sites checked in one run of the job (each PSI call can take up to 40 seconds). */
export const MAX_PER_RUN = 2;
/** A pixel counts as changed when one of its colour channels moved by more than this (0-255; JPEG noise stays below it). */
export const DIFF_CHANNEL_THRESHOLD = 32;
/** Storage bucket the old app's visual check used; the old console and the client portal read it. */
export const SCREENSHOT_BUCKET = "site-screenshots";

export const QUOTA_MESSAGE =
  "PageSpeed Insights refused the request (quota used up). Add a PAGESPEED_API_KEY in Vercel to get your own daily quota; see docs/architecture/13.";

export type VisualRowInsert = Database["public"]["Tables"]["site_visual_checks"]["Insert"];

export type PagespeedResult =
  | { ok: true; score: number; lcpMs: number; cls: number; tbtMs: number; screenshotBase64: string | null }
  | { ok: false; error: string };

/** Where the screenshot of a client's site is stored. The client id first: storage rules for the portal need it. */
export const screenshotPath = (clientId: string) => `${clientId}/latest.jpg`;

/**
 * The PageSpeed Insights request URL. Only http(s) sites are accepted. The key, when there is one, goes last; the
 * URL itself must never be logged or shown (see redactKey).
 */
export function psiUrl(siteUrl: string, key: string | null): string {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error("The site address is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http and https sites can be checked");
  const params = new URLSearchParams({ url: parsed.toString(), strategy: "mobile", category: "performance" });
  if (key) params.set("key", key);
  return `${PSI_ENDPOINT}?${params.toString()}`;
}

/** Removes the API key (raw or URL-encoded) from any text before it is stored or logged. */
export function redactKey(text: string, key: string | null): string {
  if (!key) return text;
  let out = text.split(key).join("[key]");
  const encoded = encodeURIComponent(key);
  if (encoded !== key) out = out.split(encoded).join("[key]");
  return out;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function auditValue(audits: Record<string, unknown>, id: string): number | null {
  const v = obj(audits[id])?.numericValue;
  return isNum(v) && v >= 0 ? v : null;
}

/** Reads the parts of a PageSpeed Insights answer that are stored. Anything missing or malformed is a clear error. */
export function parsePagespeed(json: unknown): PagespeedResult {
  const root = obj(json);
  if (!root) return { ok: false, error: "PageSpeed Insights sent an empty answer" };
  const apiError = obj(root.error);
  if (apiError) {
    const message = typeof apiError.message === "string" ? apiError.message : "unknown error";
    return { ok: false, error: `PageSpeed Insights error: ${message.slice(0, 300)}` };
  }
  const lh = obj(root.lighthouseResult);
  if (!lh) return { ok: false, error: "PageSpeed Insights sent no Lighthouse result" };
  const runtime = obj(lh.runtimeError);
  if (runtime && typeof runtime.code === "string" && runtime.code !== "NO_ERROR") {
    const message = typeof runtime.message === "string" ? runtime.message : runtime.code;
    return { ok: false, error: `Lighthouse could not test the page: ${message.slice(0, 300)}` };
  }
  const score = obj(obj(lh.categories)?.performance)?.score;
  const audits = obj(lh.audits);
  if (!isNum(score) || score < 0 || score > 1 || !audits) return { ok: false, error: "PageSpeed Insights sent no performance score" };
  const lcp = auditValue(audits, "largest-contentful-paint");
  const cls = auditValue(audits, "cumulative-layout-shift");
  const tbt = auditValue(audits, "total-blocking-time");
  if (lcp === null || cls === null || tbt === null) return { ok: false, error: "PageSpeed Insights sent incomplete measurements" };

  let screenshotBase64: string | null = null;
  const data = obj(obj(audits["final-screenshot"])?.details)?.data;
  if (typeof data === "string") {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (m && m[1] && m[1].length <= MAX_SCREENSHOT_BASE64) screenshotBase64 = m[1];
  }
  return { ok: true, score: Math.round(score * 100), lcpMs: Math.round(lcp), cls: Math.round(cls * 1000) / 1000, tbtMs: Math.round(tbt), screenshotBase64 };
}

/**
 * Share of pixels (0-100, 2 decimals) that changed between two RGBA images of the same size. A pixel changed when
 * any colour channel moved by more than DIFF_CHANNEL_THRESHOLD.
 */
export function diffPercent(prev: ArrayLike<number>, curr: ArrayLike<number>, width: number, height: number): number {
  const pixels = width * height;
  if (pixels <= 0 || prev.length < pixels * 4 || curr.length < pixels * 4) throw new Error("Image data does not match its size");
  let changed = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const d = Math.max(Math.abs((prev[i] ?? 0) - (curr[i] ?? 0)), Math.abs((prev[i + 1] ?? 0) - (curr[i + 1] ?? 0)), Math.abs((prev[i + 2] ?? 0) - (curr[i + 2] ?? 0)));
    if (d > DIFF_CHANNEL_THRESHOLD) changed += 1;
  }
  return Math.round((changed / pixels) * 10000) / 100;
}

export interface VisualPrevious {
  clientId: string;
  lastCheckedAt: string | null;
}

/**
 * Which sites to check in this run: never-checked sites first, then the oldest check, and only sites whose last
 * check is at least `staleAfterHours` old. At most `maxPerRun`.
 */
export function pickDueSites(
  targets: ScanTarget[],
  previous: VisualPrevious[],
  now: Date,
  opts: { maxPerRun?: number; staleAfterHours?: number } = {},
): ScanTarget[] {
  const maxPerRun = opts.maxPerRun ?? MAX_PER_RUN;
  const staleMs = (opts.staleAfterHours ?? STALE_AFTER_HOURS) * 3_600_000;
  const last = new Map(previous.map((p) => [p.clientId, p.lastCheckedAt ? Date.parse(p.lastCheckedAt) : null]));
  return targets
    .map((t) => ({ t, at: last.get(t.clientId) ?? null }))
    .filter(({ at }) => at === null || Number.isNaN(at) || now.getTime() - at >= staleMs)
    .sort((a, b) => (a.at === null || Number.isNaN(a.at) ? -Infinity : a.at) - (b.at === null || Number.isNaN(b.at) ? -Infinity : b.at) || a.t.clientId.localeCompare(b.t.clientId))
    .slice(0, Math.max(0, maxPerRun))
    .map(({ t }) => t);
}

/** The full row after a successful check. */
export function buildVisualRow(
  target: ScanTarget,
  result: Extract<PagespeedResult, { ok: true }>,
  stored: { path: string | null; diff: number | null },
  checkedAt: Date,
): VisualRowInsert {
  return {
    client_id: target.clientId,
    url: target.url,
    screenshot_path: stored.path,
    diff_percent: stored.diff,
    lcp_ms: result.lcpMs,
    cls: result.cls,
    tbt_ms: result.tbtMs,
    performance_score: result.score,
    last_checked_at: checkedAt.toISOString(),
    last_error: null,
  };
}

/** After a failed check only these columns are written, so the last good measurements stay (as in the old app). */
export function buildVisualErrorRow(target: ScanTarget, error: string, checkedAt: Date): VisualRowInsert {
  return { client_id: target.clientId, url: target.url, last_checked_at: checkedAt.toISOString(), last_error: error.slice(0, 500) };
}

export interface SpeedOutcome {
  clientName: string;
  ok: boolean;
  score: number | null;
  lcpMs: number | null;
  diff: number | null;
  error: string | null;
}

/** The sentence shown after "Check speed now". */
export function speedMessage(o: SpeedOutcome): string {
  if (!o.ok) return `${o.clientName}: the speed check failed. ${o.error ?? ""}`.trim();
  const lcp = o.lcpMs === null ? "" : `, largest content after ${(o.lcpMs / 1000).toFixed(1)} s`;
  const diff = o.diff === null ? "" : `, ${o.diff}% of the page changed since the last check`;
  return `${o.clientName}: speed ${o.score ?? "n/a"}/100${lcp}${diff}.`;
}
