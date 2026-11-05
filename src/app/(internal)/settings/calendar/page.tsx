import { ActionForm } from "@/ui/ActionForm";
import { requireOwner } from "@/platform/auth/actor";
import { getCalendar } from "@/domains/admin/service";
import { WEEKDAY_NAMES } from "@/domains/admin/rules";
import { addHolidayAction, removeHolidayAction, saveCalendarAction } from "../actions";

export const metadata = { title: "Business calendar" };

export default async function CalendarPage() {
  const actor = await requireOwner();
  const cal = await getCalendar(actor);
  return (
    <section>
      <h1>Business calendar</h1>
      <p>Business-day rules (reply within 1 business day, follow-ups at +2, +5 and +10 business days, report deadlines) use these settings. Calendar-day rules do not.</p>
      <ActionForm action={saveCalendarAction} submitLabel="Save calendar">
        <p><label>Time zone <input name="timeZone" defaultValue={cal.timeZone} required /></label> (IANA name, for example America/New_York)</p>
        <fieldset>
          <legend>Working days</legend>
          {WEEKDAY_NAMES.map((name, i) => (
            <label key={name}>
              <input type="checkbox" name="workingDays" value={i} defaultChecked={cal.workingDays.includes(i)} /> {name}{" "}
            </label>
          ))}
        </fieldset>
      </ActionForm>

      <h2>Holidays</h2>
      {cal.holidays.length === 0 ? (
        <p>No holidays entered. Business days are not skipped for any holiday until you add them.</p>
      ) : (
        <table>
          <thead><tr><th>Date</th><th>Label</th><th></th></tr></thead>
          <tbody>
            {cal.holidays.map((h) => (
              <tr key={h.date}>
                <td>{h.date}</td>
                <td>{h.label}</td>
                <td>
                  <ActionForm action={removeHolidayAction} submitLabel="Remove">
                    <input type="hidden" name="date" value={h.date} />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Add a holiday</h3>
      <ActionForm action={addHolidayAction} submitLabel="Add holiday">
        <p><label>Date <input name="date" type="date" required /></label></p>
        <p><label>Label <input name="label" required maxLength={100} /></label></p>
      </ActionForm>
    </section>
  );
}
