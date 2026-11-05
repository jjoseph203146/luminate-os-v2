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
}

export interface SiteIssue {
  id: string;
  clientId: string | null;
  title: string;
  level: string | null;
  lastSeen: string | null;
  webUrl: string | null;
}

export interface MonitoringOverview {
  sites: SiteMonitor[];
  issues: SiteIssue[];
  timeZone: string;
  /** Wall-clock time the page was built, ISO. */
  asOf: string;
}

/** What the alert job remembers about one alert. */
export interface AlertStateRow {
  key: string;
  state: string;
}
