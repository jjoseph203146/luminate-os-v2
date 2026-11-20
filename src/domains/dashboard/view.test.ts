import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/app/(internal)/dashboard/DashboardView";
import { buildOwnerDashboard } from "./rules";
import type { DashboardFacts } from "./types";

function html(facts: DashboardFacts): string {
  const dash = buildOwnerDashboard(facts);
  return renderToStaticMarkup(createElement(DashboardView, { dash }));
}

const base: DashboardFacts = {
  today: "2026-11-20",
  timeZone: "America/New_York",
  generatedAt: "2026-11-20T15:00:00.000Z",
  leads: { available: true, pipelineAvailable: true, truncated: false, rows: [] },
  clients: { available: true, truncated: false, rows: [] },
  payments: { available: true, truncated: false, rows: [] },
};

describe("DashboardView", () => {
  it("shows empty states and keeps a won deal out of the paid total", () => {
    const page = html({
      ...base,
      leads: {
        available: true,
        pipelineAvailable: true,
        truncated: false,
        rows: [
          {
            id: "won",
            businessName: "Won Co",
            stage: "won",
            source: "Referral",
            value: 9000,
            createdAt: "2026-11-18T15:00:00Z",
            followUpDate: null,
            clientId: null,
            stageChangedAt: "2026-11-18T15:00:00Z",
            lastTouchAt: "2026-11-18T15:00:00Z",
            nextStep: "Do not show notes",
            nextStepOn: null,
            lostReason: null,
            kind: "inbound",
          },
        ],
      },
      payments: { available: true, truncated: false, rows: [{ amount: 49, status: "paid", paidAt: "2026-11-18T15:00:00Z", clientId: null }] },
    });
    expect(page).toContain("Won is not revenue");
    expect(page).not.toContain("No leads yet");
    expect(page).toContain("$9,000.00");
    expect(page).toContain("$49.00");
    expect(page).not.toContain("$9,049.00");
    expect(page).not.toContain("Do not show notes");
    expect(page).toContain("Won · no client linked");
    expect(page).toContain("No follow-ups are due.");
    expect(page).toContain("No next step is due.");
    expect(page).toContain("No open lead is stale.");
    expect(page).toContain("No clients yet.");
    expect(page).not.toContain("ada@");
    expect(page).not.toContain("555-");
  });

  it("uses empty copy when the tables exist and have no rows", () => {
    const page = html(base);
    expect(page).toContain("No leads yet.");
    expect(page).toContain("No new leads this week.");
    expect(page).toContain("No lost leads, so there are no lost reasons.");
    expect(page).toContain("No follow-ups are due.");
    expect(page).toContain("No next step is due.");
    expect(page).toContain("No open lead is stale.");
    expect(page).toContain("No leads yet, so none are linked to a client.");
    expect(page).toContain("No clients yet.");
    expect(page).toContain("No paid payments recorded.");
  });

  it("says when the tables are missing instead of showing zeros", () => {
    const page = html({ ...base, leads: { available: false }, clients: { available: false }, payments: { available: false } });
    expect(page).toContain("Leads are unavailable");
    expect(page).toContain("Clients are unavailable");
    expect(page).toContain("Paid revenue is unavailable");
    expect(page).toContain("Pipeline is unavailable");
    expect(page).not.toContain("$0.00");
  });
});
