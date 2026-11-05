// Database access for the admin domain. Called only from service.ts.
// Settings go through the signed-in owner's session so row-level security applies.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { BusinessCalendar, BusinessProfile, CarePlanTemplate, CatalogItem } from "./types";

type Db = SupabaseClient<Database>;

export class RepoError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "RepoError";
    this.code = code;
  }
}

function fail(what: string, error: { code?: string } | null): never {
  throw new RepoError(`Could not ${what}`, error?.code ?? null);
}

// --- business profile ------------------------------------------------------

export async function getBusinessProfile(db: Db): Promise<BusinessProfile> {
  const { data, error } = await db.from("business_profile").select("*").eq("id", true).single();
  if (error) fail("read the business profile", error);
  return {
    legalName: data.legal_name,
    displayName: data.display_name,
    contactEmail: data.contact_email,
    phone: data.phone,
    mailingAddress: data.mailing_address,
    websiteUrl: data.website_url,
    updatedAt: data.updated_at,
  };
}

export async function updateBusinessProfile(db: Db, v: Omit<BusinessProfile, "updatedAt">, userId: string): Promise<void> {
  const { error } = await db
    .from("business_profile")
    .update({
      legal_name: v.legalName,
      display_name: v.displayName,
      contact_email: v.contactEmail,
      phone: v.phone,
      mailing_address: v.mailingAddress,
      website_url: v.websiteUrl,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", true);
  if (error) fail("save the business profile", error);
}

// --- calendar --------------------------------------------------------------

export async function getCalendar(db: Db): Promise<BusinessCalendar> {
  const [cal, holidays] = await Promise.all([
    db.from("business_calendar").select("*").eq("id", true).single(),
    db.from("business_holidays").select("holiday_date, label").order("holiday_date"),
  ]);
  if (cal.error) fail("read the business calendar", cal.error);
  if (holidays.error) fail("read holidays", holidays.error);
  return {
    timeZone: cal.data.time_zone,
    workingDays: [...cal.data.working_days].sort((a, b) => a - b),
    holidays: holidays.data.map((h) => ({ date: h.holiday_date, label: h.label })),
    updatedAt: cal.data.updated_at,
  };
}

export async function updateCalendar(db: Db, v: { timeZone: string; workingDays: number[] }, userId: string): Promise<void> {
  const { error } = await db
    .from("business_calendar")
    .update({ time_zone: v.timeZone, working_days: v.workingDays, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", true);
  if (error) fail("save the business calendar", error);
}

export async function addHoliday(db: Db, v: { date: string; label: string }, userId: string): Promise<void> {
  const { error } = await db.from("business_holidays").insert({ holiday_date: v.date, label: v.label, created_by: userId });
  if (error) {
    if (error.code === "23505") throw new RepoError("That date is already a holiday.", error.code);
    fail("add the holiday", error);
  }
}

export async function removeHoliday(db: Db, date: string): Promise<{ label: string } | null> {
  const found = await db.from("business_holidays").select("label").eq("holiday_date", date).maybeSingle();
  if (found.error) fail("read the holiday", found.error);
  if (!found.data) return null;
  const { error } = await db.from("business_holidays").delete().eq("holiday_date", date);
  if (error) fail("remove the holiday", error);
  return { label: found.data.label };
}

// --- catalog ---------------------------------------------------------------

type CatalogRow = Database["public"]["Tables"]["catalog_items"]["Row"];

function toCatalogItem(r: CatalogRow): CatalogItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind as CatalogItem["kind"],
    pricingModel: r.pricing_model as CatalogItem["pricingModel"],
    priceCents: r.price_cents,
    percentValue: r.percent_value,
    description: r.description,
    internalBenchmarkCents: r.internal_benchmark_cents,
    watchPricing: r.watch_pricing,
    active: r.active,
    sortOrder: r.sort_order,
  };
}

export async function listCatalogItems(db: Db): Promise<CatalogItem[]> {
  const { data, error } = await db.from("catalog_items").select("*").order("sort_order").order("name");
  if (error) fail("read the catalog", error);
  return data.map(toCatalogItem);
}

export async function getCatalogItem(db: Db, id: string): Promise<CatalogItem | null> {
  const { data, error } = await db.from("catalog_items").select("*").eq("id", id).maybeSingle();
  if (error) fail("read the catalog item", error);
  return data ? toCatalogItem(data) : null;
}

export async function updateCatalogItem(
  db: Db,
  id: string,
  v: Pick<CatalogItem, "name" | "description" | "priceCents" | "percentValue" | "internalBenchmarkCents" | "watchPricing" | "active" | "sortOrder">,
  userId: string,
): Promise<void> {
  const { error } = await db
    .from("catalog_items")
    .update({
      name: v.name,
      description: v.description,
      price_cents: v.priceCents,
      percent_value: v.percentValue,
      internal_benchmark_cents: v.internalBenchmarkCents,
      watch_pricing: v.watchPricing,
      active: v.active,
      sort_order: v.sortOrder,
      updated_by: userId,
    })
    .eq("id", id);
  if (error) fail("save the catalog item", error);
}

export async function createCatalogItem(db: Db, v: Omit<CatalogItem, "id">, userId: string): Promise<CatalogItem> {
  const { data, error } = await db
    .from("catalog_items")
    .insert({
      code: v.code,
      name: v.name,
      kind: v.kind,
      pricing_model: v.pricingModel,
      price_cents: v.priceCents,
      percent_value: v.percentValue,
      description: v.description,
      internal_benchmark_cents: v.internalBenchmarkCents,
      watch_pricing: v.watchPricing,
      active: v.active,
      sort_order: v.sortOrder,
      updated_by: userId,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new RepoError("That code is already used.", error.code);
    fail("create the catalog item", error);
  }
  return toCatalogItem(data);
}

// --- care plan templates ---------------------------------------------------

type CareRow = Database["public"]["Tables"]["care_plan_templates"]["Row"];

function toCarePlan(r: CareRow): CarePlanTemplate {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    monthlyPriceCents: r.monthly_price_cents,
    smallUpdatesPerCycle: r.small_updates_per_cycle,
    responseTargetBusinessDays: r.response_target_business_days,
    prioritySupport: r.priority_support,
    includedServices: r.included_services,
    active: r.active,
    sortOrder: r.sort_order,
  };
}

export async function listCarePlans(db: Db): Promise<CarePlanTemplate[]> {
  const { data, error } = await db.from("care_plan_templates").select("*").order("sort_order").order("name");
  if (error) fail("read care plans", error);
  return data.map(toCarePlan);
}

export async function getCarePlan(db: Db, id: string): Promise<CarePlanTemplate | null> {
  const { data, error } = await db.from("care_plan_templates").select("*").eq("id", id).maybeSingle();
  if (error) fail("read the care plan", error);
  return data ? toCarePlan(data) : null;
}

export async function updateCarePlan(db: Db, id: string, v: Omit<CarePlanTemplate, "id" | "code">, userId: string): Promise<void> {
  const { error } = await db
    .from("care_plan_templates")
    .update({
      name: v.name,
      monthly_price_cents: v.monthlyPriceCents,
      small_updates_per_cycle: v.smallUpdatesPerCycle,
      response_target_business_days: v.responseTargetBusinessDays,
      priority_support: v.prioritySupport,
      included_services: v.includedServices,
      active: v.active,
      sort_order: v.sortOrder,
      updated_by: userId,
    })
    .eq("id", id);
  if (error) fail("save the care plan", error);
}

export async function createCarePlan(db: Db, v: Omit<CarePlanTemplate, "id">, userId: string): Promise<CarePlanTemplate> {
  const { data, error } = await db
    .from("care_plan_templates")
    .insert({
      code: v.code,
      name: v.name,
      monthly_price_cents: v.monthlyPriceCents,
      small_updates_per_cycle: v.smallUpdatesPerCycle,
      response_target_business_days: v.responseTargetBusinessDays,
      priority_support: v.prioritySupport,
      included_services: v.includedServices,
      active: v.active,
      sort_order: v.sortOrder,
      updated_by: userId,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new RepoError("That code is already used.", error.code);
    fail("create the care plan", error);
  }
  return toCarePlan(data);
}

// --- audit log -------------------------------------------------------------

export async function listAudit(
  db: Db,
  q: { page: number; pageSize: number; entityType: string | null; action: string | null },
) {
  let query = db
    .from("audit_log")
    .select("id, occurred_at, actor_type, actor_id, action, entity_type, entity_id, before, after, request_ip", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
  if (q.entityType) query = query.eq("entity_type", q.entityType);
  // Prefix match; escape LIKE wildcards in the user's text.
  if (q.action) query = query.like("action", `${q.action.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query;
  if (error) fail("read the audit log", error);
  return { rows: data, total: count ?? 0 };
}
