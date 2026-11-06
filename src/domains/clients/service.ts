// Clients domain: the only entry point for the directory and the client workspace.
// Every function takes an actor and checks permission first.
import { z } from "zod";
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { readDb } from "@/platform/db/server";
import { writeAudit } from "@/platform/audit/audit";
import { parseInput } from "@/platform/auth/schemas";
import { PermissionError, RuleError } from "@/platform/errors";
import {
  CLIENT_FLAGS,
  cleanSearch,
  flagMessage,
  nextFlagValue,
  normalizeWebsiteUrl,
  parseStatusFilter,
  sameWebsite,
  type ClientFlag,
} from "./rules";
import { addWebsiteSchema, clientDetailsSchema, clientFlagSchema, projectUrlSchema, removeWebsiteSchema, updateWebsiteSchema } from "./schemas";
import * as repo from "./repo";
import type { ClientListItem, ClientWorkspace } from "./types";

const idSchema = z.string().uuid();

export async function listClients(
  actor: Actor,
  input: { search?: string | null; status?: string | null; includeArchived?: boolean },
): Promise<ClientListItem[]> {
  assertCan(actor, "clients.read");
  const db = await readDb(actor);
  return repo.listClients(
    db,
    {
      search: cleanSearch(input.search),
      status: parseStatusFilter(input.status),
      includeArchived: input.includeArchived === true,
    },
    new Date(),
  );
}

/** Returns null when the id is not a valid id or the client does not exist. */
export async function getClientWorkspace(actor: Actor, id: string): Promise<ClientWorkspace | null> {
  assertCan(actor, "clients.read");
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return null;
  const db = await readDb(actor);
  return repo.getClientWorkspace(db, parsed.data, new Date());
}

// --- Client changes ----------------------------------------------------------------------------------------

export interface ChangeResult {
  message: string;
  /** False when nothing needed to change (already in that state, or no edits). */
  changed: boolean;
}

const NOT_FOUND = "That client could not be found. It may have been deleted.";
const NO_SAVE = "Nothing was saved. Your session may not have admin access. Sign in again and retry.";

/** Writes run as the signed-in owner, so row-level security still applies. */
async function writeDb(actor: Actor) {
  if (actor.type !== "owner") throw new PermissionError();
  return readDb(actor);
}

async function loadClient(db: Awaited<ReturnType<typeof writeDb>>, clientId: string) {
  const client = await repo.getClientForChange(db, clientId);
  if (!client) throw new RuleError(NOT_FOUND);
  return client;
}

/**
 * Archive / restore, put on hold / release, stop / resume monitoring.
 * Each is one timestamp on the client; history, payments and monitoring rows all stay.
 * Turning a switch on that is already on keeps its original date and writes nothing.
 */
export async function setClientFlag(actor: Actor, raw: unknown, now: () => Date = () => new Date()): Promise<ChangeResult> {
  assertCan(actor, "clients.write");
  const input = parseInput(clientFlagSchema, raw);
  const flag: ClientFlag = input.flag;
  if (flag === "archived" && input.on && !input.confirm) throw new RuleError("Tick the box to confirm you want to archive this client.");
  const db = await writeDb(actor);
  const client = await loadClient(db, input.clientId);
  const spec = CLIENT_FLAGS[flag];
  const before = client[spec.column];
  const after = nextFlagValue(before, input.on, now().toISOString());
  if (before === after) return { message: flagMessage(flag, input.on, false), changed: false };

  if (!(await repo.updateClient(db, client.id, { [spec.column]: after }))) throw new RuleError(NO_SAVE);
  await repo.logActivity(db, client.id, "client", client.id, input.on ? spec.on : spec.off);
  await writeAudit(actor, {
    action: `client.${input.on ? spec.on.replace(/^client_/, "") : spec.off.replace(/^client_/, "")}`,
    entityType: "client",
    entityId: client.id,
    clientId: client.id,
    before: { [spec.column]: before },
    after: { [spec.column]: after },
  });
  return { message: flagMessage(flag, input.on, true), changed: true };
}

const DETAIL_COLUMNS = {
  businessName: "business_name",
  contactName: "contact_name",
  email: "email",
  phone: "phone",
  planName: "plan_name",
  clientSince: "client_since",
  revisionsIncluded: "revisions_included",
} as const;

const CONTACT_COLUMNS = new Set(["contact_name", "email", "phone"]);

/** Edits the client's name, contact details, care plan name, start date and included updates. Stripe-owned fields are not editable here. */
export async function updateClientDetails(actor: Actor, raw: unknown): Promise<ChangeResult> {
  assertCan(actor, "clients.write");
  const input = parseInput(clientDetailsSchema, raw);
  const db = await writeDb(actor);
  const client = await loadClient(db, input.clientId);

  const patch: Record<string, string | number | null> = {};
  const before: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(DETAIL_COLUMNS) as [keyof typeof DETAIL_COLUMNS, (typeof DETAIL_COLUMNS)[keyof typeof DETAIL_COLUMNS]][]) {
    const next = input[key];
    if (next !== client[column]) {
      patch[column] = next;
      before[column] = client[column];
    }
  }
  if (Object.keys(patch).length === 0) return { message: "No changes to save.", changed: false };

  if (!(await repo.updateClient(db, client.id, patch))) throw new RuleError(NO_SAVE);
  // Contact details stay out of the audit log (the client row holds them): only which of them changed.
  const pick = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => !CONTACT_COLUMNS.has(k)));
  await writeAudit(actor, {
    action: "client.details_updated",
    entityType: "client",
    entityId: client.id,
    clientId: client.id,
    before: pick(before),
    after: { ...pick(patch), changed: Object.keys(patch) },
  });
  return { message: "Client details saved.", changed: true };
}

function cleanUrl(raw: string): string {
  const result = normalizeWebsiteUrl(raw);
  if ("error" in result) throw new RuleError(result.error);
  return result.url;
}

/** Adds a website to the client. If the client has no project address, the first website is the one monitoring watches. */
export async function addClientWebsite(actor: Actor, raw: unknown): Promise<ChangeResult> {
  assertCan(actor, "clients.write");
  const input = parseInput(addWebsiteSchema, raw);
  const url = cleanUrl(input.url);
  const db = await writeDb(actor);
  const client = await loadClient(db, input.clientId);
  const existing = await repo.listWebsites(db, client.id);
  if (existing.length >= 20) throw new RuleError("A client can have at most 20 websites.");
  if (existing.some((w) => sameWebsite(w.url, url))) throw new RuleError("That website is already listed for this client.");

  const row = await repo.insertWebsite(db, client.id, input.label, url);
  await writeAudit(actor, { action: "client_website.added", entityType: "client_website", entityId: row.id, clientId: client.id, after: { label: row.label, url: row.url } });
  return { message: "Website added.", changed: true };
}

export async function updateClientWebsite(actor: Actor, raw: unknown): Promise<ChangeResult> {
  assertCan(actor, "clients.write");
  const input = parseInput(updateWebsiteSchema, raw);
  const url = cleanUrl(input.url);
  const db = await writeDb(actor);
  const client = await loadClient(db, input.clientId);
  const existing = await repo.listWebsites(db, client.id);
  const site = existing.find((w) => w.id === input.websiteId);
  if (!site) throw new RuleError("That website could not be found for this client.");
  if (existing.some((w) => w.id !== site.id && sameWebsite(w.url, url))) throw new RuleError("That website is already listed for this client.");
  if (site.url === url && site.label === input.label) return { message: "No changes to save.", changed: false };

  if (!(await repo.updateWebsite(db, client.id, site.id, { label: input.label, url }))) throw new RuleError(NO_SAVE);
  await writeAudit(actor, {
    action: "client_website.updated",
    entityType: "client_website",
    entityId: site.id,
    clientId: client.id,
    before: { label: site.label, url: site.url },
    after: { label: input.label, url },
  });
  return { message: "Website saved.", changed: true };
}

export async function removeClientWebsite(actor: Actor, raw: unknown): Promise<ChangeResult> {
  assertCan(actor, "clients.write");
  const input = parseInput(removeWebsiteSchema, raw);
  if (!input.confirm) throw new RuleError("Tick the box to confirm you want to remove this website.");
  const db = await writeDb(actor);
  const client = await loadClient(db, input.clientId);
  const site = (await repo.listWebsites(db, client.id)).find((w) => w.id === input.websiteId);
  if (!site) throw new RuleError("That website could not be found for this client.");

  if (!(await repo.deleteWebsite(db, client.id, site.id))) throw new RuleError(NO_SAVE);
  await writeAudit(actor, { action: "client_website.removed", entityType: "client_website", entityId: site.id, clientId: client.id, before: { label: site.label, url: site.url } });
  return { message: "Website removed.", changed: true };
}

/**
 * Sets the live address on the client's project. When set, it is the address monitoring watches
 * (it wins over the client's websites). Empty clears it, so monitoring falls back to the websites.
 */
export async function setProjectUrl(actor: Actor, raw: unknown): Promise<ChangeResult> {
  assertCan(actor, "clients.write");
  const input = parseInput(projectUrlSchema, raw);
  const url = input.url.trim() === "" ? null : cleanUrl(input.url);
  const db = await writeDb(actor);
  const client = await loadClient(db, input.clientId);
  const project = (await repo.listProjectUrls(db, client.id)).find((p) => p.id === input.projectId);
  if (!project) throw new RuleError("That project could not be found for this client.");
  if ((project.production_url ?? null) === url) return { message: "No changes to save.", changed: false };

  if (!(await repo.setProjectProductionUrl(db, client.id, project.id, url))) throw new RuleError(NO_SAVE);
  await writeAudit(actor, {
    action: "project.production_url_updated",
    entityType: "project",
    entityId: project.id,
    clientId: client.id,
    before: { production_url: project.production_url },
    after: { production_url: url },
  });
  return { message: url ? "Live address saved." : "Live address cleared. Monitoring now uses the client's first website.", changed: true };
}

