import { ActionForm } from "@/ui/ActionForm";
import { BTN_PRIMARY, BTN_SMALL, Card, Heading } from "@/ui/forms";
import { requireOwner } from "@/platform/auth/actor";
import { formatInTimeZone } from "@/platform/calendar/business-days";
import { getCalendar } from "@/domains/admin/service";
import { listDevices, pushStatus, registeredFingerprints } from "@/domains/notifications/service";
import { NOTIFICATION_EVENTS } from "@/domains/notifications/events";
import { removePushDeviceAction, sendTestPushAction } from "../actions";
import { PushControls } from "./PushControls";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const actor = await requireOwner();
  const [devices, { timeZone }, registered] = await Promise.all([listDevices(actor), getCalendar(actor), registeredFingerprints(actor)]);
  const status = pushStatus(actor);
  return (
    <div className="flex flex-col gap-5">
      <section>
        <Heading>This device</Heading>
        <Card className="px-4 py-4">
          <PushControls publicKey={status.publicKey} registered={registered} />
        </Card>
      </section>

      <section>
        <Heading>What you will be notified about</Heading>
        <Card className="overflow-hidden">
          {NOTIFICATION_EVENTS.map((e) => (
            <div key={e.title} className="border-t border-line px-4 py-3 first:border-t-0">
              <div className="text-[15px] font-medium">{e.title}</div>
              <div className="mt-0.5 text-[13px] leading-[1.45] text-dim">{e.when}</div>
              <div className="mt-1 font-mono text-[12px] text-dim">e.g. {e.example}</div>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <Heading>Registered devices</Heading>
        <Card className="overflow-hidden">
          {devices.length === 0 ? (
            <div className="px-4 py-5 text-center text-[13px] text-dim">No device yet. Turn notifications on above.</div>
          ) : (
            devices.map((d) => (
              <div key={d.id} className="flex min-h-[58px] items-center gap-3 border-t border-line px-3.5 py-2 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{d.label ?? "Device"}</div>
                  <div className="mt-0.5 truncate text-[12px] text-dim">
                    Added {formatInTimeZone(d.createdAt, timeZone)}
                    {d.lastSuccessAt ? ` · last delivered ${formatInTimeZone(d.lastSuccessAt, timeZone)}` : " · nothing delivered yet"}
                    {d.failureCount > 0 ? ` · ${d.failureCount} failed` : ""}
                  </div>
                </div>
                <ActionForm action={removePushDeviceAction} submitLabel="Remove" buttonClassName={BTN_SMALL}>
                  <input type="hidden" name="id" value={d.id} />
                </ActionForm>
              </div>
            ))
          )}
        </Card>
        {devices.length > 0 && (
          <ActionForm action={sendTestPushAction} submitLabel="Send a test notification" className="mt-3 flex flex-col gap-3" buttonClassName={BTN_PRIMARY} note="Sends to every registered device." >
            <span />
          </ActionForm>
        )}
      </section>
    </div>
  );
}
