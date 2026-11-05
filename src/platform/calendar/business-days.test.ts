import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  addCalendarDays,
  businessDaysBetween,
  calendarProblems,
  formatInTimeZone,
  isBusinessDay,
  isValidIsoDate,
  isValidTimeZone,
  toLocalDate,
  type CalendarConfig,
} from "./business-days";

// Owner decision: every day is a working day except Saturday.
const noSaturday: CalendarConfig = {
  timeZone: "America/New_York",
  workingDays: [0, 1, 2, 3, 4, 5],
  holidays: new Set(),
};
const monToFri: CalendarConfig = { ...noSaturday, workingDays: [1, 2, 3, 4, 5] };

describe("isValidIsoDate", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isValidIsoDate("2026-11-04")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("11/04/2026")).toBe(false);
  });
});

describe("addCalendarDays", () => {
  it("crosses month and year ends", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addCalendarDays("2026-11-04", 30)).toBe("2026-12-04");
  });
});

describe("isBusinessDay", () => {
  it("treats Saturday as the only day off in the owner's calendar", () => {
    expect(isBusinessDay("2026-11-06", noSaturday)).toBe(true); // Friday
    expect(isBusinessDay("2026-11-07", noSaturday)).toBe(false); // Saturday
    expect(isBusinessDay("2026-11-08", noSaturday)).toBe(true); // Sunday
  });
  it("excludes holidays", () => {
    const cal = { ...noSaturday, holidays: new Set(["2026-11-26"]) };
    expect(isBusinessDay("2026-11-26", cal)).toBe(false);
  });
});

describe("addBusinessDays", () => {
  it("returns the start date for zero days", () => {
    expect(addBusinessDays("2026-11-07", 0, noSaturday)).toBe("2026-11-07");
  });
  it("skips Saturday only, in the owner's calendar", () => {
    expect(addBusinessDays("2026-11-06", 1, noSaturday)).toBe("2026-11-08"); // Fri -> Sun
    expect(addBusinessDays("2026-11-06", 2, noSaturday)).toBe("2026-11-09"); // Fri -> Mon
    expect(addBusinessDays("2026-11-04", 5, noSaturday)).toBe("2026-11-10"); // Wed +5, skipping Sat
  });
  it("skips weekends in a Monday to Friday calendar", () => {
    expect(addBusinessDays("2026-11-06", 1, monToFri)).toBe("2026-11-09");
    expect(addBusinessDays("2026-11-04", 10, monToFri)).toBe("2026-11-18");
  });
  it("starts counting after a non-working start date", () => {
    expect(addBusinessDays("2026-11-07", 1, noSaturday)).toBe("2026-11-08");
  });
  it("skips holidays", () => {
    const cal = { ...monToFri, holidays: new Set(["2026-11-26"]) };
    expect(addBusinessDays("2026-11-25", 1, cal)).toBe("2026-11-27");
  });
  it("rejects bad input", () => {
    expect(() => addBusinessDays("2026-11-04", -1, noSaturday)).toThrow(RangeError);
    expect(() => addBusinessDays("2026-11-04", 1.5, noSaturday)).toThrow(RangeError);
    expect(() => addBusinessDays("nope", 1, noSaturday)).toThrow(RangeError);
    expect(() => addBusinessDays("2026-11-04", 1, { ...noSaturday, workingDays: [] })).toThrow(RangeError);
  });
});

describe("businessDaysBetween", () => {
  it("counts business days after the start, up to and including the end", () => {
    expect(businessDaysBetween("2026-11-04", "2026-11-04", noSaturday)).toBe(0);
    expect(businessDaysBetween("2026-11-04", "2026-11-10", noSaturday)).toBe(5);
    expect(businessDaysBetween("2026-11-04", "2026-11-10", monToFri)).toBe(4);
  });
  it("is the inverse of addBusinessDays", () => {
    for (const n of [1, 2, 5, 10, 17]) {
      const end = addBusinessDays("2026-11-04", n, noSaturday);
      expect(businessDaysBetween("2026-11-04", end, noSaturday)).toBe(n);
    }
  });
  it("rejects a reversed range", () => {
    expect(() => businessDaysBetween("2026-11-05", "2026-11-04", noSaturday)).toThrow(RangeError);
  });
});

describe("time zones", () => {
  it("uses the business time zone for the local date", () => {
    // 03:30 UTC on Nov 5 is 22:30 on Nov 4 in New York (EST).
    expect(toLocalDate(new Date("2026-11-05T03:30:00Z"), "America/New_York")).toBe("2026-11-04");
    expect(toLocalDate(new Date("2026-11-05T03:30:00Z"), "UTC")).toBe("2026-11-05");
  });
  it("validates IANA names", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
  it("formats in the given zone", () => {
    expect(formatInTimeZone("2026-11-05T03:30:00Z", "America/New_York")).toContain("Nov 04, 2026");
    expect(formatInTimeZone("not a date", "UTC")).toBe("");
  });
});

describe("calendarProblems", () => {
  it("accepts the owner's calendar", () => {
    expect(calendarProblems(noSaturday)).toEqual([]);
  });
  it("reports each problem", () => {
    expect(calendarProblems({ timeZone: "Nope/Nope", workingDays: [] }).length).toBe(2);
    expect(calendarProblems({ timeZone: "UTC", workingDays: [1, 1] })).toHaveLength(1);
    expect(calendarProblems({ timeZone: "UTC", workingDays: [7] })).toHaveLength(1);
  });
});
