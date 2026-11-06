// The "Manage" tab and the editable Websites list on the client workspace.
import type { ReactNode } from "react";
import type { ClientProject, ClientWebsite, ClientWorkspace } from "@/domains/clients/types";
import type { MonitoredAddress } from "@/domains/clients/rules";
import { ActionForm } from "@/ui/ActionForm";
import { BTN_PRIMARY, BTN_SMALL, INPUT, MONO_INPUT, Stack } from "@/ui/forms";
import {
  addClientWebsiteAction,
  removeClientWebsiteAction,
  setClientFlagAction,
  setProjectUrlAction,
  updateClientDetailsAction,
  updateClientWebsiteAction,
} from "./actions";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");

function Panel({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5">
      <div>
        <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
        {note && <p className="m-0 mt-1 text-[13px] leading-normal text-dim">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function FlagRow({
  clientId,
  flag,
  isOn,
  title,
  explain,
  state,
  onLabel,
  offLabel,
  confirmLabel,
}: {
  clientId: string;
  flag: "archived" | "on_hold" | "monitoring_paused";
  isOn: boolean;
  title: string;
  explain: string;
  state: string;
  onLabel: string;
  offLabel: string;
  confirmLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div>
        <div className="text-[15px] font-medium">{title}</div>
        <div className="mt-0.5 text-[13px] leading-normal text-dim">{explain}</div>
        <div className="mt-0.5 text-[13px]">{state}</div>
      </div>
      <ActionForm action={setClientFlagAction} submitLabel={isOn ? offLabel : onLabel} className="flex flex-col items-start gap-2" buttonClassName={BTN_SMALL}>
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="flag" value={flag} />
        <input type="hidden" name="on" value={isOn ? "0" : "1"} />
        {!isOn && confirmLabel && (
          <label className="flex items-center gap-2.5 text-[14px]">
            <input type="checkbox" name="confirm" required className="h-[18px] w-[18px] flex-none accent-primary" />
            {confirmLabel}
          </label>
        )}
      </ActionForm>
    </div>
  );
}

/** Archive, hold, monitoring switches and the details form. */
export function ManageTab({ ws }: { ws: ClientWorkspace }) {
  const c = ws.client;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
      <Panel title="Status">
        <FlagRow
          clientId={c.id}
          flag="archived"
          isOn={c.archivedAt !== null}
          title="Archive"
          explain="Hides the client from lists, Today and every scheduled job, including monitoring. Nothing is deleted."
          state={c.archivedAt ? `Archived on ${date(c.archivedAt)}.` : "Not archived."}
          onLabel="Archive client"
          offLabel="Restore client"
          confirmLabel="Yes, archive this client"
        />
        <FlagRow
          clientId={c.id}
          flag="on_hold"
          isOn={c.onHoldSince !== null}
          title="On hold"
          explain="Keeps the client listed but mutes their site alerts. A successful payment releases the hold automatically."
          state={c.onHoldSince ? `On hold since ${date(c.onHoldSince)}.` : "Not on hold."}
          onLabel="Put on hold"
          offLabel="Release hold"
        />
        <FlagRow
          clientId={c.id}
          flag="monitoring_paused"
          isOn={c.monitoringPausedAt !== null}
          title="Site monitoring"
          explain="Stopping skips this client's scans and site alerts. Past results are kept; resuming picks up at the next scheduled scan."
          state={c.monitoringPausedAt ? `Stopped on ${date(c.monitoringPausedAt)}.` : "On."}
          onLabel="Stop monitoring"
          offLabel="Resume monitoring"
        />
      </Panel>

      <Panel title="Edit details" note="Plan price, status and Stripe links come from Stripe and are not edited here.">
        <ActionForm action={updateClientDetailsAction} submitLabel="Save details" className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
          <input type="hidden" name="clientId" value={c.id} />
          <Stack label="Business name">
            <input name="businessName" defaultValue={c.businessName} required maxLength={120} className={INPUT} autoComplete="off" />
          </Stack>
          <Stack label="Primary contact">
            <input name="contactName" defaultValue={c.contactName === "Unknown" ? "" : c.contactName} placeholder="Unknown" maxLength={120} className={INPUT} autoComplete="off" />
          </Stack>
          <Stack label="Email">
            <input name="email" type="email" defaultValue={c.email === "no-email" ? "" : c.email} placeholder="No email recorded" maxLength={254} className={INPUT} autoComplete="off" />
          </Stack>
          <Stack label="Phone">
            <input name="phone" type="tel" defaultValue={c.phone ?? ""} maxLength={40} className={INPUT} autoComplete="off" />
          </Stack>
          <Stack label="Care plan name">
            <input name="planName" defaultValue={c.planName ?? ""} placeholder="No care plan" maxLength={80} className={INPUT} autoComplete="off" />
          </Stack>
          <div className="grid grid-cols-2 gap-3">
            <Stack label="Client since">
              <input name="clientSince" type="date" defaultValue={c.clientSince ?? ""} className={INPUT} />
            </Stack>
            <Stack label="Updates per cycle">
              <input name="revisionsIncluded" type="number" min={0} max={100} step={1} defaultValue={c.revisionsIncluded} required className={INPUT} />
            </Stack>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}

function MonitoredTag() {
  return <span className="rounded-full bg-green-soft px-[7px] py-[3px] text-[11px] font-medium text-green">Monitored</span>;
}

function WebsiteEditor({ clientId, w, monitored }: { clientId: string; w: ClientWebsite; monitored: boolean }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{w.url}</span>
        {monitored && <MonitoredTag />}
      </div>
      <ActionForm action={updateClientWebsiteAction} submitLabel="Save website" className="flex flex-col gap-2" buttonClassName={BTN_SMALL}>
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="websiteId" value={w.id} />
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
          <Stack label="Label">
            <input name="label" defaultValue={w.label} maxLength={60} className={INPUT} autoComplete="off" />
          </Stack>
          <Stack label="Address">
            <input name="url" defaultValue={w.url} required maxLength={500} className={MONO_INPUT} inputMode="url" autoComplete="off" />
          </Stack>
        </div>
      </ActionForm>
      <ActionForm action={removeClientWebsiteAction} submitLabel="Remove website" className="flex flex-wrap items-center gap-3" buttonClassName={BTN_SMALL}>
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="websiteId" value={w.id} />
        <label className="flex items-center gap-2 text-[13px] text-dim">
          <input type="checkbox" name="confirm" required className="h-4 w-4 flex-none accent-primary" />
          Yes, remove it
        </label>
      </ActionForm>
    </div>
  );
}

function ProjectUrlEditor({ clientId, p, monitored }: { clientId: string; p: ClientProject; monitored: boolean }) {
  return (
    <ActionForm action={setProjectUrlAction} submitLabel="Save live address" className="flex flex-col gap-2" buttonClassName={BTN_SMALL}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={p.id} />
      <Stack label={<span className="flex items-center gap-2">{p.name ?? "Project"} · live address {monitored && <MonitoredTag />}</span>}>
        <input name="url" defaultValue={p.productionUrl ?? ""} placeholder="https://example.com" maxLength={500} className={MONO_INPUT} inputMode="url" autoComplete="off" />
      </Stack>
    </ActionForm>
  );
}

/** "Websites to monitor": which address is watched, and the forms that change it. */
export function WebsitesEditor({ ws, monitored }: { ws: ClientWorkspace; monitored: MonitoredAddress | null }) {
  const clientId = ws.client.id;
  const paused = ws.client.monitoringPausedAt !== null || ws.client.archivedAt !== null;
  return (
    <Panel
      title="Websites to monitor"
      note={
        <>
          Monitoring watches one address per client: the project&apos;s live address when there is one, otherwise the first website below.{" "}
          {monitored ? (
            <>
              Watched now: <span className="font-mono text-ink">{monitored.url}</span>
              {paused ? " (monitoring is stopped for this client)." : "."}
            </>
          ) : (
            "No address is recorded, so this client is not scanned."
          )}
        </>
      }
    >
      {ws.projects.map((p) => (
        <ProjectUrlEditor key={p.id} clientId={clientId} p={p} monitored={monitored?.source === "project" && monitored.id === p.id} />
      ))}
      {ws.websites.map((w) => (
        <WebsiteEditor key={w.id} clientId={clientId} w={w} monitored={monitored?.source === "website" && monitored.id === w.id} />
      ))}
      <ActionForm action={addClientWebsiteAction} submitLabel="Add website" className="flex flex-col gap-2 border-t border-line pt-3" buttonClassName={BTN_SMALL}>
        <input type="hidden" name="clientId" value={clientId} />
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
          <Stack label="Label">
            <input name="label" placeholder="Production" maxLength={60} className={INPUT} autoComplete="off" />
          </Stack>
          <Stack label="New website address">
            <input name="url" placeholder="https://example.com" required maxLength={500} className={MONO_INPUT} inputMode="url" autoComplete="off" />
          </Stack>
        </div>
      </ActionForm>
    </Panel>
  );
}
