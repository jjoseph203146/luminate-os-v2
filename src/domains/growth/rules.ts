// Pure rules for the Growth screen. No database, easy to test.
import { NOT_GIVEN, WEBSITE_SOURCE } from "./intake";
import { LOST_REASONS, STAGES, type GrowthSummary, type Lead, type LeadKind, type LeadStatus, type LostReason, type Stage } from "./types";

/** The old app's lead status mapped to the new stages (open decision D4). */
export const STATUS_TO_STAGE: Record<string, Stage> = {
  interested: "new_lead",
  contacted: "in_discussion",
  quoted: "proposal_sent",
  won: "won",
  lost: "lost",
};

export const STAGE_LABEL: Record<Stage, string> = {
  new_lead: "New lead",
  in_discussion: "In discussion",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  price: "Price",
  timing: "Timing",
  competitor: "Competitor",
  unresponsive: "Unresponsive",
  not_fit: "Not a fit",
  other: "Other",
};

export const KIND_LABEL: Record<LeadKind, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
};

/** An unknown status is shown as a new lead rather than hidden. */
export function stageOf(status: string): Stage {
  return STATUS_TO_STAGE[status] ?? "new_lead";
}

/**
 * The value written to `leads.status` for a stage. The database only accepts the old app's five values
 * (leads_status_check), and that check cannot change while the old app shares the database.
 */
export const STAGE_TO_STATUS: Record<Stage, LeadStatus> = {
  new_lead: "interested",
  in_discussion: "contacted",
  proposal_sent: "quoted",
  won: "won",
  lost: "lost",
};

export function statusOf(stage: Stage): LeadStatus {
  return STAGE_TO_STATUS[stage];
}

/** The old app's suggested sources. Source is free text in the database, so any other value still saves. */
export const LEAD_SOURCES = ["Referral", "Website", WEBSITE_SOURCE, "Social Media", "Cold Outreach", "Networking", "Existing Client", "Other"] as const;

/** The editable fields of a lead, as saved. lastTouchAt and clientId are not here: a full edit must not clear them. */
export interface LeadFields {
  name: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  followUpDate: string | null;
  source: string | null;
  value: number | null;
  nextStep: string | null;
  nextStepOn: string | null;
  lostReason: LostReason | null;
  kind: LeadKind | null;
  campaign: string | null;
}

export const LEAD_FIELDS = ["name", "businessName", "email", "phone", "notes", "followUpDate", "source", "value", "nextStep", "nextStepOn", "lostReason", "kind", "campaign"] as const satisfies readonly (keyof LeadFields)[];

/** Columns added by migration 0011. A full edit writes these only when one of them changed. */
export const PIPELINE_FIELDS = ["nextStep", "nextStepOn", "lostReason", "kind", "campaign"] as const satisfies readonly (keyof LeadFields)[];

export function isPipelineField(field: keyof LeadFields): boolean {
  return (PIPELINE_FIELDS as readonly string[]).includes(field);
}

/** The NAMES of the fields an edit changes (the audit log records names, never contact details). */
export function changedLeadFields(before: LeadFields, after: LeadFields): (keyof LeadFields)[] {
  return LEAD_FIELDS.filter((k) => (before[k] ?? null) !== (after[k] ?? null));
}

/** The message after a stage change. `client` is set when Won linked or created one. */
export function stageMessage(r: { stage: Stage; changed: boolean; client?: "linked" | "created" | "kept" | null }): string {
  if (r.stage === "won" && r.client === "created") return r.changed ? "Moved to Won and created a client." : "Created a client and linked it. The lead was already Won.";
  if (r.stage === "won" && r.client === "linked") return r.changed ? "Moved to Won and linked the client." : "Linked the client. The lead was already Won.";
  if (r.stage === "won" && r.client === "kept") return "Already in Won.";
  return r.changed ? `Moved to ${STAGE_LABEL[r.stage]}.` : `Already in ${STAGE_LABEL[r.stage]}.`;
}

/** The message after an edit. */
export function leadSavedMessage(changed: readonly string[]): string {
  return changed.length === 0 ? "Nothing changed." : "Lead saved.";
}

export const isOpen = (l: Pick<Lead, "stage">) => l.stage !== "won" && l.stage !== "lost";

/** Whole calendar days from `today` to `date`: negative when the date has passed. */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type FollowUpState = "overdue" | "today" | "upcoming" | "none";

export function followUpState(lead: Pick<Lead, "followUpDate" | "stage">, today: string): FollowUpState {
  if (!isOpen(lead) || !lead.followUpDate) return "none";
  const d = daysUntil(lead.followUpDate, today);
  return d < 0 ? "overdue" : d === 0 ? "today" : "upcoming";
}

/** The short note under a lead's name, e.g. "Follow-up overdue · 1 day". */
export function followUpNote(lead: Pick<Lead, "followUpDate" | "stage" | "source">, today: string): string {
  const state = followUpState(lead, today);
  if (state === "none") return lead.stage === "won" ? "Won" : lead.stage === "lost" ? "Lost" : [lead.source, "No follow-up date"].filter(Boolean).join(" · ");
  const d = daysUntil(lead.followUpDate as string, today);
  if (state === "overdue") return `Follow-up overdue · ${-d} ${-d === 1 ? "day" : "days"}`;
  if (state === "today") return "Follow-up due today";
  return `Follow-up in ${d} ${d === 1 ? "day" : "days"}`;
}

/** Shorter form for list rows, e.g. "1 day overdue". */
export function followUpShort(lead: Pick<Lead, "followUpDate" | "stage" | "source">, today: string): string {
  const state = followUpState(lead, today);
  if (state === "none") return lead.stage === "won" || lead.stage === "lost" ? "" : (lead.source ?? "No follow-up date");
  const d = daysUntil(lead.followUpDate as string, today);
  if (state === "overdue") return `${-d} ${-d === 1 ? "day" : "days"} overdue`;
  if (state === "today") return "Follow up today";
  return `Follow up in ${d} ${d === 1 ? "day" : "days"}`;
}

export function summarize(leads: Lead[], today: string): GrowthSummary {
  const open = leads.filter(isOpen);
  const won = leads.filter((l) => l.stage === "won").length;
  const lost = leads.filter((l) => l.stage === "lost").length;
  const proposals = open.filter((l) => l.stage === "proposal_sent");
  const due = open.filter((l) => l.followUpDate !== null && l.followUpDate <= today);
  return {
    pipelineValue: open.reduce((sum, l) => sum + (l.value ?? 0), 0),
    unvalued: open.filter((l) => l.value === null).length,
    openCount: open.length,
    followUpsDue: due.length,
    followUpsOverdue: due.filter((l) => (l.followUpDate as string) < today).length,
    proposalsOut: proposals.length,
    proposalNames: proposals.map((l) => l.businessName),
    won,
    lost,
    winRate: won + lost === 0 ? null : Math.round((won / (won + lost)) * 100),
    stages: STAGES.filter((s) => s !== "lost").map((stage) => ({ stage, count: leads.filter((l) => l.stage === stage).length })),
  };
}

/** Open leads with a follow-up due today or earlier, most overdue first. */
export function dueNow(leads: Lead[], today: string): Lead[] {
  return leads
    .filter((l) => isOpen(l) && l.followUpDate !== null && l.followUpDate <= today)
    .sort((a, b) => (a.followUpDate as string).localeCompare(b.followUpDate as string));
}

/** Open leads: follow-ups first (soonest), then the rest by newest. */
export function sortOpen(leads: Lead[]): Lead[] {
  return leads
    .filter(isOpen)
    .sort((a, b) => (a.followUpDate ?? "9999-12-31").localeCompare(b.followUpDate ?? "9999-12-31") || b.createdAt.localeCompare(a.createdAt));
}

// --- Won: link an existing client, or create one --------------------------------

const PLACEHOLDER_EMAILS = new Set(["no-email"]);
const PLACEHOLDER_BUSINESSES = new Set([NOT_GIVEN.toLowerCase(), "unnamed"]);

/** Email we are willing to match on. Placeholders and blanks do not match. */
export function normEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const v = email.trim().toLowerCase();
  if (!v || PLACEHOLDER_EMAILS.has(v)) return null;
  return v;
}

/** Business name we are willing to match on. Placeholders do not match. */
export function normBusiness(name: string | null | undefined): string | null {
  if (!name) return null;
  const v = name.trim().toLowerCase();
  if (!v || PLACEHOLDER_BUSINESSES.has(v)) return null;
  return v;
}

export function isLostReason(value: string | null | undefined): value is LostReason {
  return !!value && (LOST_REASONS as readonly string[]).includes(value);
}

export interface ClientCandidate {
  id: string;
  businessName: string;
  email: string;
  contactName: string;
  archived: boolean;
}

export type ClientLinkDecision =
  | { action: "keep"; clientId: string }
  | { action: "link"; clientId: string; how: "email" | "business_name" }
  | { action: "create" }
  | { action: "ambiguous"; clientIds: string[]; how: "email" | "business_name" };

function activeClients(clients: readonly ClientCandidate[]): ClientCandidate[] {
  return clients.filter((c) => !c.archived);
}

/**
 * Which client a Won lead should use.
 * Email wins over business name. Several matches are ambiguous: the caller must pass a client id.
 * Archived clients are not matched. A lead that already has a client keeps it.
 */
export function decideClientLink(
  lead: { clientId?: string | null; email: string | null; businessName: string },
  clients: readonly ClientCandidate[],
): ClientLinkDecision {
  if (lead.clientId && clients.some((c) => c.id === lead.clientId)) return { action: "keep", clientId: lead.clientId };
  const pool = activeClients(clients);
  const email = normEmail(lead.email);
  if (email) {
    const hits = pool.filter((c) => normEmail(c.email) === email);
    if (hits.length === 1) return { action: "link", clientId: hits[0]!.id, how: "email" };
    if (hits.length > 1) return { action: "ambiguous", clientIds: hits.map((c) => c.id).sort(), how: "email" };
  }
  const business = normBusiness(lead.businessName);
  if (business) {
    const hits = pool.filter((c) => normBusiness(c.businessName) === business);
    if (hits.length === 1) return { action: "link", clientId: hits[0]!.id, how: "business_name" };
    if (hits.length > 1) return { action: "ambiguous", clientIds: hits.map((c) => c.id).sort(), how: "business_name" };
  }
  return { action: "create" };
}

/** A client row created from a Won lead. Active, because the contract is signed and the deposit is paid. No Stripe id. */
export function clientFromLead(lead: { name: string; businessName: string; email: string | null; phone: string | null }): {
  business_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  status: "active";
} {
  const business = normBusiness(lead.businessName);
  const email = normEmail(lead.email);
  return {
    business_name: business ? lead.businessName.trim() : "Unnamed",
    contact_name: lead.name.trim() || "Unknown",
    email: email ?? "no-email",
    phone: lead.phone,
    status: "active",
  };
}

/** A non-archived client who has already paid (lifetime value or a paid revenue row). */
export function isPayingClient(client: { archived: boolean; lifetimeValue: number; paidRevenue: boolean }): boolean {
  return !client.archived && (client.lifetimeValue > 0 || client.paidRevenue);
}

/**
 * The Won backfill runs only against a named local or staging environment.
 * Unset and production both refuse. This does not prove the database URL is staging.
 */
export function assertBackfillEnvironment(appEnv: string | undefined): "local" | "staging" {
  if (appEnv === "local" || appEnv === "staging") return appEnv;
  throw new Error("The Won backfill runs only when APP_ENV is local or staging. It does not run against production.");
}

/** A bot must not mark Won or attach a client. The owner does that in the app. */
export const BOT_CANNOT_WIN = "A bot cannot mark a lead Won or attach a client. Record the signed contract and the paid deposit in a lead note. The owner marks Won in the app.";

/** True when a bot payload tries to set stage Won or a client id. Empty and null client ids do not count. */
export function botTriesToWin(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  if (typeof row.stage === "string" && row.stage.trim().toLowerCase() === "won") return true;
  if (!Object.prototype.hasOwnProperty.call(row, "clientId")) return false;
  const id = row.clientId;
  if (id === null || id === undefined) return false;
  if (typeof id === "string" && id.trim() === "") return false;
  return true;
}

/** `https://<ref>.supabase.co` → `<ref>`. Local and other hosts have no ref. */
export function projectRefFromSupabaseUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const match = /^([a-z0-9-]+)\.supabase\.co$/.exec(parsed.hostname.toLowerCase());
  return match?.[1] ?? null;
}

function canonicalSupabaseUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/**
 * `--apply` may write only after APP_ENV is local or staging, and after the caller confirms the database.
 * Confirmation is either `--confirm-url` equal to NEXT_PUBLIC_SUPABASE_URL, or BACKFILL_ALLOWED_PROJECT_REF
 * containing that URL's project ref. Production and an unset APP_ENV still refuse, even when the URL matches.
 */
export function assertBackfillWriteAllowed(input: {
  appEnv: string | undefined;
  supabaseUrl: string | undefined;
  confirmUrl?: string;
  allowedProjectRefs?: string;
}): "local" | "staging" {
  const env = assertBackfillEnvironment(input.appEnv);
  const expected = input.supabaseUrl ? canonicalSupabaseUrl(input.supabaseUrl) : null;
  if (!expected) {
    throw new Error("Refusing to write. NEXT_PUBLIC_SUPABASE_URL is missing or not a URL. The Won backfill does not run against production.");
  }
  const confirm = input.confirmUrl ? canonicalSupabaseUrl(input.confirmUrl) : null;
  const urlMatches = confirm !== null && confirm === expected;
  const ref = projectRefFromSupabaseUrl(expected);
  const allowed = (input.allowedProjectRefs ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const refAllowed = ref !== null && allowed.includes(ref);
  if (!urlMatches && !refAllowed) {
    throw new Error("Refusing to write. Pass --confirm-url equal to NEXT_PUBLIC_SUPABASE_URL, or set BACKFILL_ALLOWED_PROJECT_REF to this project's ref. The Won backfill does not run against production.");
  }
  return env;
}

/** The value of a single `--confirm-url=<url>` argument, or undefined when it was not passed. */
export function confirmUrlFromArgv(argv: readonly string[]): string | undefined {
  const found = argv.filter((arg) => arg.startsWith("--confirm-url="));
  if (found.length > 1) throw new Error("Pass --confirm-url once.");
  if (found.length === 0) return undefined;
  const value = found[0]!.slice("--confirm-url=".length).trim();
  if (!value) throw new Error("Pass --confirm-url equal to NEXT_PUBLIC_SUPABASE_URL.");
  return value;
}

export interface BackfillClient extends ClientCandidate {
  paying: boolean;
}

export interface BackfillLead {
  id: string;
  name: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  stage: Stage;
  clientId: string | null;
}

export type WonBackfillAction =
  | { op: "already"; leadId: string; clientId: string }
  | { op: "mark_won"; leadId: string; clientId: string }
  | { op: "link"; leadId: string; clientId: string; how: "email" | "business_name"; markWon: boolean }
  | { op: "create_client"; leadId: string }
  | { op: "ambiguous"; clientId: string; leadIds: string[]; how: "email" | "business_name" }
  | { op: "ambiguous_lead"; leadId: string; clientIds: string[]; how: "email" | "business_name" }
  | { op: "unmatched_client"; clientId: string };

export interface WonBackfillPlan {
  /** Paying, non-archived clients. The 2026-11-04 snapshot described 12 of these. */
  payingCount: number;
  actions: WonBackfillAction[];
}

function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function matchUnlinked(
  client: ClientCandidate,
  leads: readonly BackfillLead[],
  taken: ReadonlySet<string>,
): { how: "email" | "business_name"; leadIds: string[] } | null {
  const email = normEmail(client.email);
  const open = leads.filter((l) => !l.clientId && !taken.has(l.id));
  if (email) {
    const hits = open.filter((l) => normEmail(l.email) === email);
    if (hits.length > 0) return { how: "email", leadIds: hits.map((l) => l.id).sort() };
  }
  const business = normBusiness(client.businessName);
  if (business) {
    const hits = open.filter((l) => normBusiness(l.businessName) === business);
    if (hits.length > 0) return { how: "business_name", leadIds: hits.map((l) => l.id).sort() };
  }
  return null;
}

/**
 * Plan for the Won backfill. Pure: the same inputs always produce the same actions, and applying
 * the plan (linking those leads, marking them won, creating a client only for an unlinked Won lead)
 * makes a second plan a no-op aside from rows that were already ambiguous or unmatched.
 *
 * A paying client with a linked lead that is not yet Won is marked Won.
 * A paying client with no linked lead is matched to one unlinked lead by email, then by business name.
 * An already-Won lead with no client is linked, or a client is created when nothing matches.
 * Paying clients with no lead are reported. This plan does not invent a lead.
 */
export function planWonBackfill(leads: readonly BackfillLead[], clients: readonly BackfillClient[]): WonBackfillPlan {
  const paying = byId(clients.filter((c) => c.paying && !c.archived));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const actions: WonBackfillAction[] = [];
  const taken = new Set<string>();

  for (const lead of byId(leads)) {
    if (!lead.clientId) continue;
    if (lead.stage === "won") {
      actions.push({ op: "already", leadId: lead.id, clientId: lead.clientId });
      taken.add(lead.id);
      continue;
    }
    const client = clients.find((c) => c.id === lead.clientId);
    if (client?.paying && !client.archived) {
      actions.push({ op: "mark_won", leadId: lead.id, clientId: lead.clientId });
      taken.add(lead.id);
    }
  }

  for (const client of paying) {
    if (leads.some((l) => l.clientId === client.id)) continue;
    const match = matchUnlinked(client, leads, taken);
    if (!match) {
      actions.push({ op: "unmatched_client", clientId: client.id });
      continue;
    }
    if (match.leadIds.length > 1) {
      actions.push({ op: "ambiguous", clientId: client.id, leadIds: match.leadIds, how: match.how });
      for (const id of match.leadIds) taken.add(id);
      continue;
    }
    const leadId = match.leadIds[0]!;
    const lead = leadById.get(leadId);
    actions.push({ op: "link", leadId, clientId: client.id, how: match.how, markWon: lead?.stage !== "won" });
    taken.add(leadId);
  }

  for (const lead of byId(leads)) {
    if (lead.stage !== "won" || lead.clientId || taken.has(lead.id)) continue;
    const decision = decideClientLink(lead, clients);
    if (decision.action === "link") {
      actions.push({ op: "link", leadId: lead.id, clientId: decision.clientId, how: decision.how, markWon: false });
    } else if (decision.action === "ambiguous") {
      actions.push({ op: "ambiguous_lead", leadId: lead.id, clientIds: decision.clientIds, how: decision.how });
    } else if (decision.action === "create" || decision.action === "keep") {
      if (decision.action === "keep") actions.push({ op: "already", leadId: lead.id, clientId: decision.clientId });
      else actions.push({ op: "create_client", leadId: lead.id });
    }
  }

  return { payingCount: paying.length, actions };
}
