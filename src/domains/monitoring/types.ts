export type SiteStatus = "up" | "slow" | "down" | "unknown";

/** One client site, as the checker last saw it. */
export interface SiteMonitor {
  id: string;
  clientId: string;
  clientName: string;
  url: string;
  status: SiteStatus;
  responseTimeMs: number | null;
  httpStatus: number | null;
  securityScore: number | null;
  brokenLinks: number | null;
  sslExpiresAt: string | null;
  domainExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  /**
   * True when the client is archived, on hold, or has monitoring stopped. The old checker skips
   * archived and paused clients (their last check goes stale for good) and on-hold clients get no
   * alerts, so none of these may raise an alert here either.
   */
  alertsMuted: boolean;
  /** Why it is muted: archived (leaves every list), paused (not scanned) or on hold (still scanned, no alerts). */
  muteReason?: "archived" | "paused" | "on_hold";
}

export interface SiteIssue {
  id: string;
  clientId: string | null;
  title: string;
  level: string | null;
  lastSeen: string | null;
  webUrl: string | null;
}

/** The latest speed and visual check of one site (site_visual_checks). */
export interface SiteVisual {
  clientId: string;
  performanceScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  diffPercent: number | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface MonitoringOverview {
  sites: SiteMonitor[];
  issues: SiteIssue[];
  /** Speed and visual checks by client id. Missing when not read. */
  visual?: Record<string, SiteVisual>;
  timeZone: string;
  /** Wall-clock time the page was built, ISO. */
  asOf: string;
}

/** What the alert job remembers about one alert. */
export interface AlertStateRow {
  key: string;
  state: string;
}

/** What one site looked like in a scan, for the message shown after "Scan now". */
export interface ScanOutcome {
  clientId: string;
  clientName: string;
  /** "failed" = the scan or the save failed (the site's status is unknown). */
  status: "up" | "slow" | "down" | "failed";
  responseTimeMs: number | null;
}
