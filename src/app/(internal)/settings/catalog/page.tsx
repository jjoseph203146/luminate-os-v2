import { ActionForm } from "@/ui/ActionForm";
import { requireOwner } from "@/platform/auth/actor";
import { listCarePlans, listCatalog } from "@/domains/admin/service";
import { centsToInput, formatCents } from "@/domains/admin/rules";
import type { CarePlanTemplate, CatalogItem } from "@/domains/admin/types";
import {
  createCarePlanAction,
  createCatalogItemAction,
  updateCarePlanAction,
  updateCatalogItemAction,
} from "../actions";

export const metadata = { title: "Catalog and care plans" };

function priceLabel(i: CatalogItem): string {
  if (i.pricingModel === "fixed" && i.priceCents !== null) return formatCents(i.priceCents);
  if (i.pricingModel === "percent" && i.percentValue !== null) return `+${i.percentValue}%`;
  return "Quoted";
}

function CatalogRow({ item }: { item: CatalogItem }) {
  return (
    <li>
      <h3>{item.name} <small>({item.code}, {item.kind}, {priceLabel(item)}{item.active ? "" : ", inactive"})</small></h3>
      <ActionForm action={updateCatalogItemAction} submitLabel="Save">
        <input type="hidden" name="id" value={item.id} />
        <p><label>Name <input name="name" defaultValue={item.name} required maxLength={120} /></label></p>
        <p><label>What is included <textarea name="description" defaultValue={item.description ?? ""} rows={3} maxLength={2000} /></label></p>
        {item.pricingModel === "fixed" && (
          <p><label>Price (USD) <input name="price" defaultValue={centsToInput(item.priceCents)} required inputMode="decimal" /></label></p>
        )}
        {item.pricingModel === "percent" && (
          <p><label>Percentage added <input name="percent" defaultValue={item.percentValue ?? ""} required inputMode="decimal" /></label></p>
        )}
        <p><label>Internal benchmark (USD, optional) <input name="benchmark" defaultValue={centsToInput(item.internalBenchmarkCents)} inputMode="decimal" /></label></p>
        <p><label><input type="checkbox" name="watchPricing" defaultChecked={item.watchPricing} /> Watch pricing (priced below benchmark)</label></p>
        <p><label><input type="checkbox" name="active" defaultChecked={item.active} /> Active</label></p>
        <p><label>Sort order <input name="sortOrder" type="number" defaultValue={item.sortOrder} min={0} max={10000} required /></label></p>
      </ActionForm>
    </li>
  );
}

function CarePlanRow({ plan }: { plan: CarePlanTemplate }) {
  return (
    <li>
      <h3>{plan.name} <small>({plan.code}, {formatCents(plan.monthlyPriceCents)}/month{plan.active ? "" : ", inactive"})</small></h3>
      <ActionForm action={updateCarePlanAction} submitLabel="Save">
        <input type="hidden" name="id" value={plan.id} />
        <p><label>Name <input name="name" defaultValue={plan.name} required maxLength={80} /></label></p>
        <p><label>Monthly price (USD) <input name="price" defaultValue={centsToInput(plan.monthlyPriceCents)} required inputMode="decimal" /></label></p>
        <p><label>Small updates per month <input name="smallUpdates" type="number" min={0} max={99} defaultValue={plan.smallUpdatesPerCycle} required /></label></p>
        <p><label>Initial response target (business days) <input name="responseDays" type="number" min={1} max={30} defaultValue={plan.responseTargetBusinessDays} required /></label></p>
        <p><label><input type="checkbox" name="prioritySupport" defaultChecked={plan.prioritySupport} /> Priority support</label></p>
        <p><label>Included services (one per line) <textarea name="includedServices" rows={6} defaultValue={plan.includedServices.join("\n")} /></label></p>
        <p><label><input type="checkbox" name="active" defaultChecked={plan.active} /> Active</label></p>
        <p><label>Sort order <input name="sortOrder" type="number" defaultValue={plan.sortOrder} min={0} max={10000} required /></label></p>
      </ActionForm>
    </li>
  );
}

export default async function CatalogPage() {
  const actor = await requireOwner();
  const [items, plans] = await Promise.all([listCatalog(actor), listCarePlans(actor)]);
  return (
    <section>
      <h1>Catalog and care plans</h1>
      <p>These are the current defaults. Proposals and agreements keep a snapshot of the price they were made at, so changing a price here never changes an existing client&apos;s terms.</p>

      <h2>Packages and add-ons</h2>
      <ul>{items.map((i) => <CatalogRow key={i.id} item={i} />)}</ul>
      <h3>Add a catalog item</h3>
      <ActionForm action={createCatalogItemAction} submitLabel="Add item">
        <p><label>Code <input name="code" required pattern="[a-z][a-z0-9_]{1,40}" /></label></p>
        <p><label>Name <input name="name" required maxLength={120} /></label></p>
        <p><label>Kind <select name="kind"><option value="addon">Add-on</option><option value="package">Package</option></select></label></p>
        <p><label>Pricing <select name="pricingModel"><option value="fixed">Fixed price</option><option value="percent">Percentage</option><option value="quoted">Quoted</option></select></label></p>
        <p><label>Price (USD, fixed only) <input name="price" inputMode="decimal" /></label></p>
        <p><label>Percentage (percentage only) <input name="percent" inputMode="decimal" /></label></p>
        <p><label>What is included <textarea name="description" rows={3} maxLength={2000} /></label></p>
        <p><label>Internal benchmark (USD, optional) <input name="benchmark" inputMode="decimal" /></label></p>
        <p><label><input type="checkbox" name="watchPricing" /> Watch pricing</label></p>
        <p><label><input type="checkbox" name="active" defaultChecked /> Active</label></p>
        <p><label>Sort order <input name="sortOrder" type="number" defaultValue={100} min={0} max={10000} required /></label></p>
      </ActionForm>

      <h2>Care plan templates</h2>
      <ul>{plans.map((p) => <CarePlanRow key={p.id} plan={p} />)}</ul>
      <h3>Add a care plan</h3>
      <ActionForm action={createCarePlanAction} submitLabel="Add care plan">
        <p><label>Code <input name="code" required pattern="[a-z][a-z0-9_]{1,40}" /></label></p>
        <p><label>Name <input name="name" required maxLength={80} /></label></p>
        <p><label>Monthly price (USD) <input name="price" required inputMode="decimal" /></label></p>
        <p><label>Small updates per month <input name="smallUpdates" type="number" min={0} max={99} required /></label></p>
        <p><label>Initial response target (business days) <input name="responseDays" type="number" min={1} max={30} required /></label></p>
        <p><label><input type="checkbox" name="prioritySupport" /> Priority support</label></p>
        <p><label>Included services (one per line) <textarea name="includedServices" rows={6} /></label></p>
        <p><label><input type="checkbox" name="active" defaultChecked /> Active</label></p>
        <p><label>Sort order <input name="sortOrder" type="number" defaultValue={100} min={0} max={10000} required /></label></p>
      </ActionForm>
    </section>
  );
}
