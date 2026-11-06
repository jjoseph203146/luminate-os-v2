// Monitoring domain: checks every client site (the `site_checks` job), shows what it found, and sends alerts about it.
import { z } from "zod";
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { createAdminClient, readDb } from "@/platform/db/server";
import { writeAudit } from "@/platform/audit/audit";
import { RateLimitError, RuleError } from "@/platform/errors";
import { parseInput } from "@/platform/auth/schemas";
import { createRateLimiter } from "@/platform/security/rate-limit";
import { getCalendar } from "@/domains/admin/service";
import { notifyOwner } from "@/domains/notifications/service";
import { planAlerts } from "./rules";
import * as repo from "./repo";
import { scanUrl } from "./checks";
import { buildMonitorRow, unreachable, withScheme } from "./scan-rules";
import type { ScanTarget, UrlScan } from "./scan-types";
import type { MonitoringOverview, ScanOutcome } from "./types";

export async function getMonitoringOverview(actor: Actor): Promise<MonitoringOverview> {
  assertCan(actor, "monitoring.read");
  const db = await readDb(actor);
  const [sites, issues, calendar] = await Promise.all([repo.listSites(db), repo.listOpenIssues(db), getCalendar(actor)]);
  return { sites, issues, timeZone: calendar.timeZone, asOf: new Date().toISOString() };
}

export interface AlertRunSummary {
  sites: number;
  planned: number;
  sent: number;
  held: number;
}

/**
 * The scheduled alert job. Sends each planned alert, then remembers it so the same problem is not
 * announced again. If a push could not be delivered, the state is not saved and the next run retries.
 * If push is not set up or no device is registered, the state is saved anyway so old news does not
 * flood in when a phone is added later.
 */
export async function runMonitorAlerts(actor: Actor, now: Date = new Date()): Promise<AlertRunSummary> {
  assertCan(actor, "monitoring.read");
  const db = createAdminClient();
  const [sites, previous] = await Promise.all([repo.listSites(db), repo.listAlertState(db)]);
  const plan = planAlerts(sites, previous, now);
  let sent = 0;
  let held = 0;
  for (const alert of plan) {
    if (!alert.payload) {
      await repo.saveAlertState(db, alert.key, alert.state, null);
      continue;
    }
    const result = await notifyOwner(actor, alert.payload);
    const delivered = result.sent > 0;
    const nothingToSendTo = result.skipped === "not_configured" || result.skipped === "no_devices";
    if (delivered || nothingToSendTo) {
      await repo.saveAlertState(db, alert.key, alert.state, delivered ? now : null);
      if (delivered) sent += 1;
    } else {
      held += 1;
    }
  }
  return { sites: sites.length, planned: plan.length, sent, held };
}

// --- The site scan job ----------------------------------------------------------

/** Sites scanned at the same time. */
export const SCAN_CONCURRENCY = 10;
/** No new site is started after this long into a run, so the whole run ends inside the function's time limit. */
export const SCAN_START_BUDGET_MS = 15_000;
/** The longest one site may take. A site that has not answered by then is recorded as down, and the scan moves on. */
export const SITE_SCAN_CAP_MS = 22_000;

export interface ScanCandidateLike {
  clientId: string;
  clientName: string;
  archivedAt: string | null;
  monitoringPausedAt: string | null;
  projectUrl: string | null;
  websiteUrls: string[];
}

/**
 * Archived clients and clients whose monitoring was stopped are not scanned (as in the old app).
 * Clients on hold ARE scanned, so their history stays complete; alerts for them are muted elsewhere.
 */
export function isScannable(c: Pick<ScanCandidateLike, "archivedAt" | "monitoringPausedAt">): boolean {
  return c.archivedAt === null && c.monitoringPausedAt === null;
}

/** The project's production URL first, else the client's oldest website; null when there is neither. Always with a scheme. */
export function pickScanUrl(projectUrl: string | null, websiteUrls: string[]): string | null {
  const first = [projectUrl, ...websiteUrls].map((u) => u?.trim() ?? "").find((u) => u !== "");
  return first ? withScheme(first) : null;
}

export function buildScanTargets(candidates: ScanCandidateLike[]): ScanTarget[] {
  const targets: ScanTarget[] = [];
  for (const c of candidates) {
    if (!isScannable(c)) continue;
    const url = pickScanUrl(c.projectUrl, c.websiteUrls);
    if (url) targets.push({ clientId: c.clientId, clientName: c.clientName, url });
  }
  return targets;
}

export interface SiteCheckRunSummary {
  targets: number;
  /** Scanned and saved. */
  scanned: number;
  /** The scan or the save failed for these (the others are unaffected). */
  failed: number;
  /** Not started because the run was out of time; the next run scans them. */
  skippedForTime: number;
  /** Of the scanned sites, how many were found down. */
  down: number;
}

/**
 * The scheduled scan job. Checks every client site and records the result in site_monitors (latest) and
 * site_monitor_checks (history), the same tables the old app's checker wrote. One site failing never stops the others.
 * `clock` is only for tests.
 */
/** scanUrl, but never longer than `capMs`: a slow site becomes a "down" result instead of holding up the whole run. */
async function scanWithCap(url: string, capMs: number): Promise<UrlScan> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<UrlScan>((resolve) => {
    timer = setTimeout(
      () => resolve({ ...unreachable(`No response within ${Math.round(capMs / 1000)} seconds`), sslExpiresAt: null, domainExpiresAt: null, brokenLinks: null }),
      capMs,
    );
  });
  try {
    return await Promise.race([scanUrl(url), capped]);
  } finally {
    clearTimeout(timer);
  }
}

async function scanSites(clock: () => number, onlyClientId: string | null): Promise<{ summary: SiteCheckRunSummary; outcomes: ScanOutcome[]; found: boolean }> {
  const db = createAdminClient();
  const startedAt = clock();
  const all = buildScanTargets(await repo.listScanCandidates(db));
  const targets = onlyClientId ? all.filter((t) => t.clientId === onlyClientId) : all;
  const previous = await repo.getPreviousMonitors(
    db,
    targets.map((t) => t.clientId),
  );

  const summary: SiteCheckRunSummary = { targets: targets.length, scanned: 0, failed: 0, skippedForTime: 0, down: 0 };
  const outcomes: ScanOutcome[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      const target = targets[i];
      if (!target) return;
      if (clock() - startedAt >= SCAN_START_BUDGET_MS) {
        // Out of time: leave this site and every one after it for the next run.
        summary.skippedForTime += 1;
        continue;
      }
      try {
        const scan = await scanWithCap(target.url, SITE_SCAN_CAP_MS);
        const { monitor, check } = buildMonitorRow(target, scan, previous.get(target.clientId) ?? null, new Date(clock()));
        await repo.saveScan(db, monitor, check);
        summary.scanned += 1;
        if (scan.status === "down") summary.down += 1;
        outcomes.push({ clientId: target.clientId, clientName: target.clientName, status: scan.status, responseTimeMs: scan.responseTimeMs });
      } catch {
        // Client id only: the URL could carry credentials and the error text could echo it.
        console.error("site check failed for client", target.clientId);
        summary.failed += 1;
        outcomes.push({ clientId: target.clientId, clientName: target.clientName, status: "failed", responseTimeMs: null });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, () => worker()));
  return { summary, outcomes, found: targets.length > 0 };
}

export async function runSiteChecks(actor: Actor, now: Date = new Date(), clock: () => number = Date.now): Promise<SiteCheckRunSummary> {
  assertCan(actor, "monitoring.scan");
  void now;
  return (await scanSites(clock, null)).summary;
}

// --- "Scan now" (owner, from the Monitoring screen) ------------------------------------------------

type Owner = Extract<Actor, { type: "owner" }>;
const scanNowSchema = z.object({ clientId: z.string().uuid("That site was not recognised.").optional() });
/** At most this many manual scans a minute, so a stuck button cannot hammer client sites. */
const manualLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });

export interface ScanNowResult {
  summary: SiteCheckRunSummary;
  outcomes: ScanOutcome[];
}

/**
 * Scans right now: every monitored site, or just one when `clientId` is given. Same scan, same tables and same
 * rules as the scheduled job (archived and paused clients are not scanned). The alert job picks up any problem
 * within five minutes, as for a scheduled scan.
 */
export async function scanNow(actor: Owner, raw: unknown, clock: () => number = Date.now): Promise<ScanNowResult> {
  assertCan(actor, "monitoring.scan");
  const { clientId } = parseInput(scanNowSchema, raw ?? {});
  if (!manualLimiter.check(actor.userId, clock())) throw new RateLimitError("You just ran several scans. Wait a minute and try again.");
  const { summary, outcomes, found } = await scanSites(clock, clientId ?? null);
  if (clientId && !found) throw new RuleError("That site is not being monitored. It may be archived, paused, or have no website address.");
  // A line in the audit log; a failed audit write must not hide a scan that already ran.
  try {
    await writeAudit(actor, { action: "site_check.run_manual", entityType: "site_check", entityId: clientId ?? "all", clientId: clientId ?? null, after: { scanned: summary.scanned, down: summary.down, failed: summary.failed } });
  } catch {
    /* already logged by writeAudit */
  }
  return { summary, outcomes };
}
