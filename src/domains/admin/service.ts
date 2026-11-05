// Admin domain: the only entry point for Settings, users, audit log and system status.
// Every function takes an actor and checks permission first (docs/architecture/04 s2).
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { parseInput } from "@/platform/auth/schemas";
import { writeAudit } from "@/platform/audit/audit";
import { createAdminClient, createUserClient } from "@/platform/db/server";
import { envChecks, getAppSettings } from "@/platform/env";
import { RuleError } from "@/platform/errors";
import { freshness } from "@/platform/jobs/rules";
import { disableProblem, isActiveUser, pricingProblem } from "./rules";
import * as repo from "./repo";
import {
  auditQuerySchema,
  businessProfileSchema,
  calendarSchema,
  carePlanCreateSchema,
  carePlanUpdateSchema,
  catalogItemCreateSchema,
  catalogItemUpdateSchema,
  holidayRemoveSchema,
  holidaySchema,
  inviteSchema,
  userIdSchema,
} from "./schemas";
import type {
  AuditPage,
  BusinessCalendar,
  BusinessProfile,
  CarePlanTemplate,
  CatalogItem,
  SystemStatus,
  UserSummary,
} from "./types";

type Owner = Extract<Actor, { type: "owner" }>;

function repoMessage(e: unknown): never {
  if (e instanceof repo.RepoError && e.code === "23505") throw new RuleError(e.message);
  throw e;
}

// --- business profile ------------------------------------------------------

export async function getBusinessProfile(actor: Actor): Promise<BusinessProfile> {
  assertCan(actor, "settings.read");
  return repo.getBusinessProfile(await createUserClient());
}

export async function updateBusinessProfile(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "settings.write");
  const input = parseInput(businessProfileSchema, raw);
  const db = await createUserClient();
  const before = await repo.getBusinessProfile(db);
  await repo.updateBusinessProfile(db, input, actor.userId);
  await writeAudit(actor, {
    action: "business_profile.updated",
    entityType: "business_profile",
    entityId: "singleton",
    before,
    after: input,
  });
}

// --- business calendar -----------------------------------------------------

export async function getCalendar(actor: Actor): Promise<BusinessCalendar> {
  assertCan(actor, "settings.read");
  return repo.getCalendar(await createUserClient());
}

export async function updateCalendar(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "settings.write");
  const input = parseInput(calendarSchema, raw);
  const db = await createUserClient();
  const before = await repo.getCalendar(db);
  await repo.updateCalendar(db, input, actor.userId);
  await writeAudit(actor, {
    action: "business_calendar.updated",
    entityType: "business_calendar",
    entityId: "singleton",
    before: { timeZone: before.timeZone, workingDays: before.workingDays },
    after: input,
  });
}

export async function addHoliday(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "settings.write");
  const input = parseInput(holidaySchema, raw);
  try {
    await repo.addHoliday(await createUserClient(), input, actor.userId);
  } catch (e) {
    repoMessage(e);
  }
  await writeAudit(actor, { action: "business_holiday.added", entityType: "business_holiday", entityId: input.date, after: input });
}

export async function removeHoliday(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "settings.write");
  const input = parseInput(holidayRemoveSchema, raw);
  const removed = await repo.removeHoliday(await createUserClient(), input.date);
  if (!removed) throw new RuleError("That holiday no longer exists.");
  await writeAudit(actor, {
    action: "business_holiday.removed",
    entityType: "business_holiday",
    entityId: input.date,
    before: { date: input.date, label: removed.label },
  });
}

// --- catalog ---------------------------------------------------------------

export async function listCatalog(actor: Actor): Promise<CatalogItem[]> {
  assertCan(actor, "settings.read");
  return repo.listCatalogItems(await createUserClient());
}

export async function updateCatalogItem(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "settings.write");
  const input = parseInput(catalogItemUpdateSchema, raw);
  const db = await createUserClient();
  const before = await repo.getCatalogItem(db, input.id);
  if (!before) throw new RuleError("That catalog item no longer exists.");
  const next = {
    name: input.name,
    description: input.description,
    priceCents: before.pricingModel === "fixed" ? input.price : null,
    percentValue: before.pricingModel === "percent" ? input.percent : null,
    internalBenchmarkCents: input.benchmark,
    watchPricing: input.watchPricing,
    active: input.active,
    sortOrder: input.sortOrder,
  };
  const problem = pricingProblem(before.pricingModel, next);
  if (problem) throw new RuleError(problem);
  await repo.updateCatalogItem(db, input.id, next, actor.userId);
  // Price changes are the important ones to be able to explain later.
  await writeAudit(actor, {
    action: "catalog_item.updated",
    entityType: "catalog_item",
    entityId: input.id,
    before,
    after: { ...next, code: before.code },
  });
}

export async function createCatalogItem(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "settings.write");
  const input = parseInput(catalogItemCreateSchema, raw);
  const next = {
    code: input.code,
    name: input.name,
    kind: input.kind,
    pricingModel: input.pricingModel,
    priceCents: input.pricingModel === "fixed" ? input.price : null,
    percentValue: input.pricingModel === "percent" ? input.percent : null,
    description: input.description,
    internalBenchmarkCents: input.benchmark,
    watchPricing: input.watchPricing,
    active: input.active,
    sortOrder: input.sortOrder,
  };
  const problem = pricingProblem(next.pricingModel, next);
  if (problem) throw new RuleError(problem);
  let created: CatalogItem;
  try {
    created = await repo.createCatalogItem(await createUserClient(), next, actor.userId);
  } catch (e) {
    return repoMessage(e);
  }
  await writeAudit(actor, { action: "catalog_item.created", entityType: "catalog_item", entityId: created.id, after: created });
}

// --- care plan templates ---------------------------------------------------

export async function listCarePlans(actor: Actor): Promise<CarePlanTemplate[]> {
  assertCan(actor, "settings.read");
  return repo.listCarePlans(await createUserClient());
}

export async function updateCarePlan(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "settings.write");
  const input = parseInput(carePlanUpdateSchema, raw);
  const db = await createUserClient();
  const before = await repo.getCarePlan(db, input.id);
  if (!before) throw new RuleError("That care plan no longer exists.");
  const next = {
    name: input.name,
    monthlyPriceCents: input.price,
    smallUpdatesPerCycle: input.smallUpdates,
    responseTargetBusinessDays: input.responseDays,
    prioritySupport: input.prioritySupport,
    includedServices: input.includedServices,
    active: input.active,
    sortOrder: input.sortOrder,
  };
  await repo.updateCarePlan(db, input.id, next, actor.userId);
  // Existing agreements keep the terms they signed (snapshots); only new ones use these defaults.
  await writeAudit(actor, {
    action: "care_plan_template.updated",
    entityType: "care_plan_template",
    entityId: input.id,
    before,
    after: { ...next, code: before.code },
  });
}

export async function createCarePlan(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "settings.write");
  const input = parseInput(carePlanCreateSchema, raw);
  let created: CarePlanTemplate;
  try {
    created = await repo.createCarePlan(
      await createUserClient(),
      {
        code: input.code,
        name: input.name,
        monthlyPriceCents: input.price,
        smallUpdatesPerCycle: input.smallUpdates,
        responseTargetBusinessDays: input.responseDays,
        prioritySupport: input.prioritySupport,
        includedServices: input.includedServices,
        active: input.active,
        sortOrder: input.sortOrder,
      },
      actor.userId,
    );
  } catch (e) {
    return repoMessage(e);
  }
  await writeAudit(actor, { action: "care_plan_template.created", entityType: "care_plan_template", entityId: created.id, after: created });
}

// --- users -----------------------------------------------------------------

async function loadUsers(now: Date, selfId: string | null): Promise<UserSummary[]> {
  const admin = createAdminClient();
  const [users, profiles] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin.from("profiles").select("id, role"),
  ]);
  if (users.error || profiles.error) throw new Error("Could not read users");
  const roles = new Map(profiles.data.map((p) => [p.id, p.role]));
  return users.data.users.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    role: roles.get(u.id) ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    active: isActiveUser(u.banned_until, now),
    isSelf: u.id === selfId,
  }));
}

export async function listUsers(actor: Owner): Promise<UserSummary[]> {
  assertCan(actor, "users.manage");
  return loadUsers(new Date(), actor.userId);
}

export async function inviteOwner(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "users.manage");
  const { email } = parseInput(inviteSchema, raw);
  const { appUrl } = getAppSettings();
  if (!appUrl) throw new RuleError("APP_URL is not set, so invitation links cannot be built.");
  const admin = createAdminClient();
  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl}/auth/confirm` });
  if (invited.error || !invited.data.user) {
    if (invited.error?.message.toLowerCase().includes("already")) throw new RuleError("A user with that email already exists.");
    throw new Error("Could not send the invitation");
  }
  const created = await admin.from("profiles").insert({ id: invited.data.user.id, role: "admin" });
  if (created.error) throw new Error("The invitation was sent but the owner role could not be set");
  await writeAudit(actor, {
    action: "user.invited",
    entityType: "user",
    entityId: invited.data.user.id,
    after: { email, role: "admin" },
  });
}

export async function setUserDisabled(actor: Owner, raw: unknown, disabled: boolean): Promise<void> {
  assertCan(actor, "users.manage");
  const { userId } = parseInput(userIdSchema, raw);
  const users = await loadUsers(new Date(), actor.userId);
  const target = users.find((u) => u.id === userId);
  if (!target) throw new RuleError("That user no longer exists.");
  if (disabled) {
    const problem = disableProblem({
      actorUserId: actor.userId,
      targetUserId: userId,
      targetIsActiveOwner: target.role === "admin" && target.active,
      activeOwnerCount: users.filter((u) => u.role === "admin" && u.active).length,
    });
    if (problem) throw new RuleError(problem);
  }
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, {
    ban_duration: disabled ? "876000h" : "none",
  });
  if (error) throw new Error("Could not update the user");
  await writeAudit(actor, {
    action: disabled ? "user.disabled" : "user.enabled",
    entityType: "user",
    entityId: userId,
    before: { active: target.active },
    after: { active: !disabled },
  });
}

// --- audit log -------------------------------------------------------------

export const AUDIT_PAGE_SIZE = 50;

export async function listAuditLog(actor: Actor, raw: unknown): Promise<AuditPage> {
  assertCan(actor, "audit.read");
  const q = parseInput(auditQuerySchema, raw);
  const db = await createUserClient();
  const [result, calendar] = await Promise.all([
    repo.listAudit(db, { page: q.page, pageSize: AUDIT_PAGE_SIZE, entityType: q.entityType, action: q.action }),
    repo.getCalendar(db),
  ]);
  return {
    rows: result.rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      actorType: r.actor_type,
      actorId: r.actor_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: r.before,
      after: r.after,
      requestIp: r.request_ip,
    })),
    page: q.page,
    pageSize: AUDIT_PAGE_SIZE,
    total: result.total,
    timeZone: calendar.timeZone,
  };
}

// --- system status ---------------------------------------------------------

export async function getSystemStatus(actor: Actor): Promise<SystemStatus> {
  assertCan(actor, "system.read");
  const settings = getAppSettings();
  const db = await createUserClient();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [cal, hb, failed] = await Promise.all([
    repo.getCalendar(db).then((c) => c, () => null),
    db.from("jobs").select("last_run_at, interval_minutes").eq("key", "heartbeat").maybeSingle(),
    db.from("job_runs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("started_at", since),
  ]);

  return {
    appEnv: settings.appEnv,
    mfaSwitch: settings.mfaSwitch,
    mfaRequired: settings.mfaRequired,
    envChecks: envChecks(),
    databaseReachable: cal !== null,
    heartbeat: hb.data
      ? {
          freshness: freshness(hb.data.last_run_at ? new Date(hb.data.last_run_at) : null, hb.data.interval_minutes, now),
          lastRunAt: hb.data.last_run_at,
          intervalMinutes: hb.data.interval_minutes,
        }
      : null,
    failedRunsLast24h: failed.count ?? 0,
    calendar: cal ? { timeZone: cal.timeZone, workingDays: cal.workingDays, holidayCount: cal.holidays.length } : null,
    timeZone: cal?.timeZone ?? "America/New_York",
  };
}
