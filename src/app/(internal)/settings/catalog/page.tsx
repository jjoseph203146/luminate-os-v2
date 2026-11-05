import type { ReactNode } from "react";
import { ActionForm } from "@/ui/ActionForm";
import { BTN_PRIMARY, Card, Field, Heading, INPUT, MONO_INPUT, Switch, SwitchRow, TEXTAREA } from "@/ui/forms";
import { Icon } from "@/ui/Icon";
import { Pill } from "@/ui/kit";
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

/** A collapsed record: one summary line, the edit form opens underneath. */
function Fold({ summary, children, className = "" }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={`group border-t border-line first:border-t-0 ${className}`}>
      <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-3.5 py-2 hover:bg-hover [&::-webkit-details-marker]:hidden">
        {summary}
        <span className="text-dim transition-transform group-open:rotate-180"><Icon name="keyboard_arrow_down" size={20} /></span>
      </summary>
      <div className="border-t border-line px-3.5 pb-3.5 pt-2">{children}</div>
    </details>
  );
}

function CatalogRow({ item }: { item: CatalogItem }) {
  return (
    <Fold
      summary={
        <>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{item.name}</div>
            <div className="mt-0.5 truncate font-mono text-[12px] text-dim">{item.code} · {item.kind}</div>
          </div>
          {!item.active && <Pill tone="gray">Inactive</Pill>}
          {item.watchPricing && <Pill tone="amber">Watch</Pill>}
          <span className="font-mono text-[14px]">{priceLabel(item)}</span>
        </>
      }
    >
      <ActionForm action={updateCatalogItemAction} submitLabel="Save" className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
        <input type="hidden" name="id" value={item.id} />
        <div>
          <Field label="Name"><input name="name" defaultValue={item.name} required maxLength={120} className={INPUT} /></Field>
          <Field label="What is included"><textarea name="description" defaultValue={item.description ?? ""} rows={3} maxLength={2000} className={TEXTAREA} /></Field>
          {item.pricingModel === "fixed" && (
            <Field label="Price (USD)"><input name="price" defaultValue={centsToInput(item.priceCents)} required inputMode="decimal" className={MONO_INPUT} /></Field>
          )}
          {item.pricingModel === "percent" && (
            <Field label="Percentage added"><input name="percent" defaultValue={item.percentValue ?? ""} required inputMode="decimal" className={MONO_INPUT} /></Field>
          )}
          <Field label="Internal benchmark (USD, optional)"><input name="benchmark" defaultValue={centsToInput(item.internalBenchmarkCents)} inputMode="decimal" className={MONO_INPUT} /></Field>
          <Field label="Sort order"><input name="sortOrder" type="number" defaultValue={item.sortOrder} min={0} max={10000} required className={MONO_INPUT} /></Field>
        </div>
        <div className="-mx-3.5 border-y border-line">
          <SwitchRow title="Watch pricing" note="Priced below the internal benchmark.">
            <Switch name="watchPricing" defaultChecked={item.watchPricing} label="Watch pricing" />
          </SwitchRow>
          <SwitchRow title="Active">
            <Switch name="active" defaultChecked={item.active} label="Active" />
          </SwitchRow>
        </div>
      </ActionForm>
    </Fold>
  );
}

function CarePlanRow({ plan }: { plan: CarePlanTemplate }) {
  return (
    <Fold
      summary={
        <>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{plan.name}</div>
            <div className="mt-0.5 truncate text-[12px] text-dim">
              {plan.smallUpdatesPerCycle} small update{plan.smallUpdatesPerCycle === 1 ? "" : "s"}/month · response in {plan.responseTargetBusinessDays} business day{plan.responseTargetBusinessDays === 1 ? "" : "s"}
            </div>
          </div>
          {!plan.active && <Pill tone="gray">Inactive</Pill>}
          {plan.prioritySupport && <Pill tone="blue">Priority</Pill>}
          <span className="font-mono text-[14px]">{formatCents(plan.monthlyPriceCents)}/mo</span>
        </>
      }
    >
      <ActionForm action={updateCarePlanAction} submitLabel="Save" className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
        <input type="hidden" name="id" value={plan.id} />
        <div>
          <Field label="Name"><input name="name" defaultValue={plan.name} required maxLength={80} className={INPUT} /></Field>
          <Field label="Monthly price (USD)"><input name="price" defaultValue={centsToInput(plan.monthlyPriceCents)} required inputMode="decimal" className={MONO_INPUT} /></Field>
          <Field label="Small updates per month"><input name="smallUpdates" type="number" min={0} max={99} defaultValue={plan.smallUpdatesPerCycle} required className={MONO_INPUT} /></Field>
          <Field label="Response target (business days)"><input name="responseDays" type="number" min={1} max={30} defaultValue={plan.responseTargetBusinessDays} required className={MONO_INPUT} /></Field>
          <Field label="Included services" hint="One per line."><textarea name="includedServices" rows={6} defaultValue={plan.includedServices.join("\n")} className={TEXTAREA} /></Field>
          <Field label="Sort order"><input name="sortOrder" type="number" defaultValue={plan.sortOrder} min={0} max={10000} required className={MONO_INPUT} /></Field>
        </div>
        <div className="-mx-3.5 border-y border-line">
          <SwitchRow title="Priority support"><Switch name="prioritySupport" defaultChecked={plan.prioritySupport} label="Priority support" /></SwitchRow>
          <SwitchRow title="Active"><Switch name="active" defaultChecked={plan.active} label="Active" /></SwitchRow>
        </div>
      </ActionForm>
    </Fold>
  );
}

function AddFold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group mt-3 rounded-[14px] border border-dashed border-line2 bg-surface">
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-3.5 text-[14px] font-medium text-blue [&::-webkit-details-marker]:hidden">
        <Icon name="add" size={20} />
        {label}
      </summary>
      <div className="border-t border-line px-3.5 pb-3.5 pt-2">{children}</div>
    </details>
  );
}

export default async function CatalogPage() {
  const actor = await requireOwner();
  const [items, plans] = await Promise.all([listCatalog(actor), listCarePlans(actor)]);
  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 text-[13px] text-dim">
        These are the current defaults. Proposals and agreements keep a snapshot of the price they were made at, so changing a price here never changes an existing client&apos;s terms.
      </p>

      <section>
        <Heading>Packages and add-ons</Heading>
        <Card className="overflow-hidden">{items.map((i) => <CatalogRow key={i.id} item={i} />)}</Card>
        <AddFold label="Add a catalog item">
          <ActionForm action={createCatalogItemAction} submitLabel="Add item" className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
            <div>
              <Field label="Code"><input name="code" required pattern="[a-z][a-z0-9_]{1,40}" className={MONO_INPUT} /></Field>
              <Field label="Name"><input name="name" required maxLength={120} className={INPUT} /></Field>
              <Field label="Kind">
                <select name="kind" className={INPUT}><option value="addon">Add-on</option><option value="package">Package</option></select>
              </Field>
              <Field label="Pricing">
                <select name="pricingModel" className={INPUT}><option value="fixed">Fixed price</option><option value="percent">Percentage</option><option value="quoted">Quoted</option></select>
              </Field>
              <Field label="Price (USD, fixed only)"><input name="price" inputMode="decimal" className={MONO_INPUT} /></Field>
              <Field label="Percentage (percentage only)"><input name="percent" inputMode="decimal" className={MONO_INPUT} /></Field>
              <Field label="What is included"><textarea name="description" rows={3} maxLength={2000} className={TEXTAREA} /></Field>
              <Field label="Internal benchmark (USD, optional)"><input name="benchmark" inputMode="decimal" className={MONO_INPUT} /></Field>
              <Field label="Sort order"><input name="sortOrder" type="number" defaultValue={100} min={0} max={10000} required className={MONO_INPUT} /></Field>
            </div>
            <div className="-mx-3.5 border-y border-line">
              <SwitchRow title="Watch pricing"><Switch name="watchPricing" label="Watch pricing" /></SwitchRow>
              <SwitchRow title="Active"><Switch name="active" defaultChecked label="Active" /></SwitchRow>
            </div>
          </ActionForm>
        </AddFold>
      </section>

      <section>
        <Heading>Care plan templates</Heading>
        <Card className="overflow-hidden">{plans.map((p) => <CarePlanRow key={p.id} plan={p} />)}</Card>
        <AddFold label="Add a care plan">
          <ActionForm action={createCarePlanAction} submitLabel="Add care plan" className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
            <div>
              <Field label="Code"><input name="code" required pattern="[a-z][a-z0-9_]{1,40}" className={MONO_INPUT} /></Field>
              <Field label="Name"><input name="name" required maxLength={80} className={INPUT} /></Field>
              <Field label="Monthly price (USD)"><input name="price" required inputMode="decimal" className={MONO_INPUT} /></Field>
              <Field label="Small updates per month"><input name="smallUpdates" type="number" min={0} max={99} required className={MONO_INPUT} /></Field>
              <Field label="Response target (business days)"><input name="responseDays" type="number" min={1} max={30} required className={MONO_INPUT} /></Field>
              <Field label="Included services" hint="One per line."><textarea name="includedServices" rows={6} className={TEXTAREA} /></Field>
              <Field label="Sort order"><input name="sortOrder" type="number" defaultValue={100} min={0} max={10000} required className={MONO_INPUT} /></Field>
            </div>
            <div className="-mx-3.5 border-y border-line">
              <SwitchRow title="Priority support"><Switch name="prioritySupport" label="Priority support" /></SwitchRow>
              <SwitchRow title="Active"><Switch name="active" defaultChecked label="Active" /></SwitchRow>
            </div>
          </ActionForm>
        </AddFold>
      </section>
    </div>
  );
}
