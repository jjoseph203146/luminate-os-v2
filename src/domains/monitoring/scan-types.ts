// Shared shapes for the site scanner (the job that checks every client site and records the result).
// checks.ts (network) produces a UrlScan; scan-rules.ts (pure) turns it into the row stored in site_monitors.
import type { Database } from "@/types/database";

/** Everything learned about one URL in one scan. scanUrl() never throws: a failure is a result. */
export interface UrlScan {
  status: "up" | "down" | "slow";
  responseTimeMs: number | null;
  httpStatus: number | null;
  /** Passed security checks out of SECURITY_CHECK_TOTAL (8). 0 when the site could not be reached. */
  securityScore: number;
  /** Human-readable problems found, e.g. "Missing Content-Security-Policy header". */
  securityIssues: string[];
  /** The error message when the site could not be reached, else null. */
  error: string | null;
  /** ISO time the SSL certificate expires, or null (not https, or the lookup failed). */
  sslExpiresAt: string | null;
  /** ISO time the domain registration expires, or null when it could not be looked up. */
  domainExpiresAt: string | null;
  /** Broken links among the homepage's own links; null when links were not checked. */
  brokenLinks: number | null;
}

/** One client site to scan. */
export interface ScanTarget {
  clientId: string;
  clientName: string;
  /** Always has a scheme (https:// added if the stored value had none). */
  url: string;
}

/** What the monitor row held before this scan, so a failed lookup does not erase a known date. */
export interface PreviousMonitor {
  status: string | null;
  sslExpiresAt: string | null;
  domainExpiresAt: string | null;
}

export type MonitorRowInsert = Database["public"]["Tables"]["site_monitors"]["Insert"];
export type CheckRowInsert = Database["public"]["Tables"]["site_monitor_checks"]["Insert"];

export const SECURITY_CHECK_TOTAL = 8;
