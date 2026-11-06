export type MonitorState = "none" | "paused" | "up" | "slow" | "down" | "unknown" | "stale";

export interface MonitorSummary {
  state: MonitorState;
  /** Label shown to the owner. Only a fresh "up" reads as healthy. */
  label: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  url: string | null;
  lastCheckedAt: string | null;
  httpStatus: number | null;
  responseTimeMs: number | null;
  sslExpiresAt: string | null;
  domainExpiresAt: string | null;
}

export interface ClientListItem {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  status: string;
  planName: string | null;
  subscriptionPrice: number;
  openRequests: number;
  monitor: MonitorSummary;
  websites: ClientWebsite[];
  archived: boolean;
  onHold: boolean;
}

export interface ClientWebsite {
  id: string;
  label: string;
  url: string;
}

export interface ClientProject {
  id: string;
  name: string | null;
  productionUrl: string | null;
  stagingUrl: string | null;
  githubUrl: string | null;
  hostingPlatform: string;
  supabaseProjectId: string | null;
  sentryProject: string | null;
  contractStatus: string;
  blockerNote: string | null;
  buildValue: number | null;
  targetDate: string | null;
  launchedAt: string | null;
  lastDeployedAt: string | null;
}

export interface ClientRequest {
  id: string;
  displayId: string;
  title: string;
  status: string;
  category: string | null;
  billable: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface ClientPayment {
  id: string;
  /** The Stripe invoice (in_...) this payment is for, so it can be re-sent. Null for standalone charges. */
  invoiceId?: string | null;
  amount: number;
  status: string;
  eventType: string;
  paidAt: string | null;
  createdAt: string;
}

export interface ClientDocument {
  id: string;
  fileName: string;
  category: string | null;
  createdAt: string;
}

export interface ClientActivity {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
}

export interface ClientWorkspace {
  client: {
    id: string;
    businessName: string;
    contactName: string;
    email: string;
    phone: string | null;
    status: string;
    planName: string | null;
    subscriptionPrice: number;
    clientSince: string | null;
    revisionsIncluded: number;
    revisionsUsed: number;
    onHoldSince: string | null;
    monitoringPausedAt: string | null;
    archivedAt: string | null;
    hasStripeCustomer: boolean;
  };
  emails: string[];
  phones: string[];
  websites: ClientWebsite[];
  projects: ClientProject[];
  requests: ClientRequest[];
  openRequests: number;
  payments: ClientPayment[];
  documents: ClientDocument[];
  activity: ClientActivity[];
  monitor: MonitorSummary;
}
