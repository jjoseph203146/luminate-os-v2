import { ActionForm } from "@/ui/ActionForm";
import { Icon } from "@/ui/Icon";
import { BTN_PRIMARY, BTN_SMALL, Card, Heading, INPUT, MONO_INPUT, Stack, Switch } from "@/ui/forms";
import { requireOwner } from "@/platform/auth/actor";
import { getCalendar } from "@/domains/admin/service";
import { WEEKDAY_NAMES } from "@/domains/admin/rules";
import { addHolidayAction, removeHolidayAction, saveCalendarAction } from "../actions";

export const metadata = { title: "Business calendar" };

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function CalendarPage() {
  const actor = await requireOwner();
  const cal = await getCalendar(actor);
  return (
    <div className="flex flex-col gap-5">
      <ActionForm
        action={saveCalendarAction}
        submitLabel="Save calendar"
        className="flex flex-col gap-3"
        buttonClassName={BTN_PRIMARY}
        note="Business-day rules (replies, follow-ups at +2, +5 and +10 business days, report deadlines) count only open days and skip holidays. Calendar-day rules do not."
      >
        <div>
          <Heading>Time zone</Heading>
          <Card className="px-4 py-3">
            <input name="timeZone" defaultValue={cal.timeZone} required aria-label="Time zone" className={MONO_INPUT} />
            <div className="mt-1.5 text-[12px] text-dim">IANA name, for example America/New_York.</div>
          </Card>
        </div>
        <div>
          <Heading>Working days</Heading>
          <Card className="overflow-hidden">
            {WEEKDAY_NAMES.map((name, i) => {
              const on = cal.workingDays.includes(i);
              return (
                <div key={name} className="flex min-h-[54px] items-center gap-3 border-t border-line px-3.5 py-1.5 first:border-t-0">
                  <span className="w-16 text-[15px] font-medium">{name.slice(0, 3)}</span>
                  <span className="flex-1 font-mono text-[14px] text-dim">{on ? "Open" : "Closed"}</span>
                  <Switch name="workingDays" value={String(i)} defaultChecked={on} label={`${name} is a working day`} />
                </div>
              );
            })}
          </Card>
          <p className="mx-0.5 mb-0 mt-2 text-[12px] text-dim">The label updates after you save.</p>
        </div>
      </ActionForm>

      <div>
        <Heading>Holidays</Heading>
        <Card className="overflow-hidden">
          {cal.holidays.length === 0 ? (
            <div className="px-4 py-5 text-center text-[13px] text-dim">No holidays entered. Business days are not skipped for any holiday until you add them.</div>
          ) : (
            cal.holidays.map((h) => (
              <div key={h.date} className="flex min-h-[52px] items-center gap-3 border-t border-line py-1.5 pl-3.5 pr-1.5 first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-[15px]">{h.label}</span>
                <span className="font-mono text-[13px] text-dim">{dayLabel(h.date)}</span>
                <ActionForm action={removeHolidayAction} submitLabel="Remove" buttonClassName={BTN_SMALL}>
                  <input type="hidden" name="date" value={h.date} />
                </ActionForm>
              </div>
            ))
          )}
        </Card>
        <ActionForm action={addHolidayAction} submitLabel="Add holiday" className="mt-3 flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
          <Card className="grid gap-3 px-4 py-3 md:grid-cols-[180px_1fr]">
            <Stack label="Date"><input name="date" type="date" required className={INPUT} /></Stack>
            <Stack label="Label"><input name="label" required maxLength={100} placeholder="Thanksgiving" className={INPUT} /></Stack>
          </Card>
        </ActionForm>
      </div>

      <Card className="flex items-center gap-3 px-3.5 py-3">
        <span className="text-dim"><Icon name="event" size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium">Google Calendar</div>
          <div className="mt-0.5 text-[13px] text-dim">Not built yet. Hours and holidays are used on their own.</div>
        </div>
      </Card>
    </div>
  );
}
