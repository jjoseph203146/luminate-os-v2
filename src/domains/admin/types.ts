export interface BusinessProfile {
  legalName: string;
  displayName: string | null;
  contactEmail: string | null;
  phone: string | null;
  mailingAddress: string | null;
  websiteUrl: string | null;
  updatedAt: string;
}

export interface BusinessCalendar {
  timeZone: string;
  workingDays: number[];
  holidays: { date: string; label: string }[];
  updatedAt: string;
}

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  kind: "package" | "addon";
  pricingModel: "fixed" | "percent" | "quoted";
  priceCents: number | null;
  percentValue: number | null;
  description: string | null;
  internalBenchmarkCents: number | null;
  watchPricing: boolean;
  active: boolean;
  sortOrder: number;
}

export interface CarePlanTemplate {
  id: string;
  code: string;
  name: string;
  monthlyPriceCents: number;
  smallUpdatesPerCycle: number;
  responseTargetBusinessDays: number;
  prioritySupport: boolean;
  includedServices: string[];
  active: boolean;
  sortOrder: number;
}

export interface UserSummary {
  id: string;
  email: string | null;
  role: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  active: boolean;
  isSelf: boolean;
}

export interface AuditRowView {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestIp: string | null;
}

export interface AuditPage {
  rows: AuditRowView[];
  page: number;
  pageSize: number;
  total: number;
  timeZone: string;
}

export interface SystemStatus {
  appEnv: "local" | "staging" | "production";
  mfaSwitch: boolean;
  mfaRequired: boolean;
  envChecks: { name: string; required: boolean; present: boolean }[];
  databaseReachable: boolean;
  heartbeat: { freshness: "never" | "ok" | "stale"; lastRunAt: string | null; intervalMinutes: number } | null;
  failedRunsLast24h: number;
  calendar: { timeZone: string; workingDays: number[]; holidayCount: number } | null;
  timeZone: string;
}
