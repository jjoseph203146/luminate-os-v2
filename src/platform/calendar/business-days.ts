// The one implementation of business-day maths (docs/architecture/06 s1).
//
// Dates are plain ISO strings ("YYYY-MM-DD") in the business time zone, so
// there is no time-of-day or daylight-saving drift in the arithmetic.
// Working days use 0 = Sunday ... 6 = Saturday.
// Calendar-day rules (30-day stale lead, payment ladder, etc.) use
// addCalendarDays, not business days.

export interface CalendarConfig {
  timeZone: string;
  workingDays: readonly number[];
  holidays: ReadonlySet<string>;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_BUSINESS_DAYS = 3660;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return formatIsoDate(d) === value;
}

function parseIsoDate(value: string): Date {
  if (!isValidIsoDate(value)) throw new RangeError(`Invalid ISO date: ${value}`);
  const m = ISO_DATE.exec(value) as RegExpExecArray;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatIsoDate(d: Date): string {
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function dayOfWeek(isoDate: string): number {
  return parseIsoDate(isoDate).getUTCDay();
}

export function addCalendarDays(isoDate: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  const d = parseIsoDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIsoDate(d);
}

/** Days in a month (month 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The date for `day` of a month, moved to the month's last day when the month is shorter (the 31st in April is
 * April 30; the 29th-31st in February is Feb 28, or 29 in a leap year). Doc 06 s4. Month is 1-12; it may run past
 * 12 or below 1 and rolls into the next or previous year.
 */
export function monthDayClamped(year: number, month: number, day: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  return formatIsoDate(new Date(Date.UTC(y, m - 1, Math.min(day, daysInMonth(y, m)))));
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** The calendar date at `instant` in the given time zone. */
export function toLocalDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Human-readable date and time in the business time zone, for screens. */
export function formatInTimeZone(instant: Date | string, timeZone: string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

export function calendarProblems(config: {
  timeZone: string;
  workingDays: readonly number[];
}): string[] {
  const problems: string[] = [];
  if (!isValidTimeZone(config.timeZone)) problems.push("Time zone is not a valid IANA time zone.");
  const days = config.workingDays;
  if (days.length === 0) problems.push("At least one working day is required.");
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    problems.push("Working days must be numbers from 0 (Sunday) to 6 (Saturday).");
  }
  if (new Set(days).size !== days.length) problems.push("Working days must not repeat.");
  return problems;
}

export function isBusinessDay(isoDate: string, calendar: CalendarConfig): boolean {
  return calendar.workingDays.includes(dayOfWeek(isoDate)) && !calendar.holidays.has(isoDate);
}

/**
 * `start` plus `count` business days. The start date itself never counts, so
 * "within 1 business day of Friday" is the next working day after Friday.
 * `count` of 0 returns `start` unchanged.
 */
export function addBusinessDays(start: string, count: number, calendar: CalendarConfig): string {
  if (!Number.isInteger(count) || count < 0 || count > MAX_BUSINESS_DAYS) {
    throw new RangeError(`count must be an integer from 0 to ${MAX_BUSINESS_DAYS}`);
  }
  const problems = calendarProblems(calendar);
  if (problems.length > 0) throw new RangeError(problems.join(" "));
  let current = start;
  parseIsoDate(current);
  let remaining = count;
  // Holidays are finite, so this always ends; the bound only guards bad input.
  for (let guard = 0; remaining > 0 && guard < MAX_BUSINESS_DAYS * 10; guard++) {
    current = addCalendarDays(current, 1);
    if (isBusinessDay(current, calendar)) remaining--;
  }
  return current;
}

/** Number of business days after `from` up to and including `to`. */
export function businessDaysBetween(from: string, to: string, calendar: CalendarConfig): number {
  if (to < from) throw new RangeError("to must not be before from");
  let count = 0;
  let current = from;
  for (let guard = 0; current < to && guard < 100000; guard++) {
    current = addCalendarDays(current, 1);
    if (isBusinessDay(current, calendar)) count++;
  }
  return count;
}
