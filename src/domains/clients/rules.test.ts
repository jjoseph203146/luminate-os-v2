import { describe, expect, it } from "vitest";
import { ageLabel, cleanSearch, parseStatusFilter, phoneHref, safeUrl, summarizeMonitor, type MonitorRow } from "./rules";

const now = new Date("2026-11-05T12:00:00Z");
const row = (over: Partial<NonNullable<MonitorRow>> = {}): MonitorRow => ({
  status: "up",
  url: "https://example.com",
  last_checked_at: "2026-11-05T11:30:00Z",
  http_status: 200,
  response_time_ms: 300,
  ssl_expires_at: null,
  domain_expires_at: null,
  ...over,
});

describe("cleanSearch", () => {
  it("removes characters that could break an or() filter", () => {
    expect(cleanSearch('a,b)(c"d%e*f_g')).toBe("a b c d e f g");
  });
  it("trims, collapses spaces and limits length", () => {
    expect(cleanSearch("  hello    world ")).toBe("hello world");
    expect(cleanSearch("x".repeat(200))).toHaveLength(60);
  });
  it("returns empty for nothing", () => {
    expect(cleanSearch(null)).toBe("");
    expect(cleanSearch(" , ")).toBe("");
  });
});

describe("summarizeMonitor", () => {
  it("shows a fresh up check as healthy", () => {
    const m = summarizeMonitor(row(), false, now);
    expect(m.state).toBe("up");
    expect(m.tone).toBe("ok");
  });
  it("never shows an old up check as healthy", () => {
    const m = summarizeMonitor(row({ last_checked_at: "2026-11-02T00:00:00Z" }), false, now);
    expect(m.state).toBe("stale");
    expect(m.tone).not.toBe("ok");
  });
  it("treats a record that was never checked as stale", () => {
    expect(summarizeMonitor(row({ last_checked_at: null }), false, now).state).toBe("stale");
  });
  it("reports no monitoring and paused monitoring", () => {
    expect(summarizeMonitor(null, false, now).state).toBe("none");
    expect(summarizeMonitor(row(), true, now).state).toBe("paused");
  });
  it("reports down and slow when fresh", () => {
    expect(summarizeMonitor(row({ status: "down" }), false, now).tone).toBe("bad");
    expect(summarizeMonitor(row({ status: "slow" }), false, now).tone).toBe("warn");
  });
  it("does not trust an unknown status", () => {
    expect(summarizeMonitor(row({ status: "weird" }), false, now).state).toBe("unknown");
  });
});

describe("ageLabel", () => {
  it("describes ages", () => {
    expect(ageLabel("2026-11-05T11:55:00Z", now)).toBe("5 min ago");
    expect(ageLabel("2026-11-05T09:00:00Z", now)).toBe("3 h ago");
    expect(ageLabel("2026-11-01T12:00:00Z", now)).toBe("4 d ago");
    expect(ageLabel(null, now)).toBe("never");
  });
});

describe("parseStatusFilter", () => {
  it("accepts known statuses only", () => {
    expect(parseStatusFilter("past_due")).toBe("past_due");
    expect(parseStatusFilter("nope")).toBeNull();
    expect(parseStatusFilter(undefined)).toBeNull();
  });
});

describe("safeUrl", () => {
  it("allows http and https, adds https when missing", () => {
    expect(safeUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(safeUrl("a.com")).toBe("https://a.com/");
  });
  it("rejects other schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,hi")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe("phoneHref", () => {
  it("keeps digits and a leading plus", () => {
    expect(phoneHref("(803) 555-0142")).toBe("8035550142");
    expect(phoneHref("+1 803 555 0142")).toBe("+18035550142");
  });
  it("rejects short or empty values", () => {
    expect(phoneHref("12")).toBeNull();
    expect(phoneHref(null)).toBeNull();
  });
});
