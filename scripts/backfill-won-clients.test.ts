import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());

vi.mock("@/domains/growth/service", () => ({ runWonBackfill: run }));

import { formatPreviewOutput, main } from "./backfill-won-clients";
import type { WonBackfillResult } from "@/domains/growth/service";

const ID = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function previewResult(extra: Record<string, unknown> = {}): WonBackfillResult {
  return {
    payingCount: 1,
    actions: [{ op: "link", leadId: ID, clientId: CLIENT, how: "email", markWon: true }],
    target: "production",
    projectRef: "prodref",
    apply: false,
    preview: true,
    applied: [],
    roster: {
      clients: [{ id: CLIENT, businessName: "Nova Barbershop", paying: true, archived: false }],
      leads: [{ id: ID, businessName: "Nova Barbershop", stage: "new_lead", clientId: null }],
    },
    ...extra,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  run.mockReset();
});

describe("backfill script", () => {
  it("errors when preview is mixed with apply or dry-run", async () => {
    await expect(main(["node", "backfill-won-clients.ts", "--preview", "--apply"])).rejects.toThrow(/only one of --dry-run, --apply, or --preview/);
    await expect(main(["node", "backfill-won-clients.ts", "--preview", "--dry-run"])).rejects.toThrow(/only one of --dry-run, --apply, or --preview/);
    expect(run).not.toHaveBeenCalled();
  });

  it("prints a read-only preview with business names and no contact fields", async () => {
    const poisoned = previewResult();
    (poisoned.roster.clients[0] as { email?: string; phone?: string; notes?: string }).email = "marcus@nova.example";
    (poisoned.roster.clients[0] as { phone?: string }).phone = "(803) 555-0142";
    (poisoned.roster.clients[0] as { notes?: string }).notes = "private note";
    (poisoned.roster.leads[0] as { email?: string }).email = "lead@nova.example";
    (poisoned.actions[0] as { email?: string; phone?: string; notes?: string }).email = "hidden@nova.example";
    (poisoned.actions[0] as { phone?: string }).phone = "(803) 555-0199";
    (poisoned.actions[0] as { notes?: string }).notes = "do not print";
    poisoned.applied = [{ op: "link", leadId: ID, clientId: CLIENT, created: false, email: "applied@nova.example" } as unknown as WonBackfillResult["applied"][number]];
    run.mockResolvedValue(poisoned);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "super-secret-service-role-key";
    try {
      await main(["node", "backfill-won-clients.ts", "--preview", "--i-know-this-is-production"]);
    } finally {
      if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    }
    const text = lines.join("\n");
    expect(text.startsWith("mode: preview")).toBe(true);
    expect(text).toContain("target project ref: prodref");
    expect(text).toContain("READ ONLY, nothing written");
    expect(text).toContain("Nova Barbershop");
    expect(text).toContain('"payingCount": 1');
    expect(text).toContain('"link"');
    expect(text).not.toMatch(/"(email|phone|notes)":/);
    expect(text).not.toContain("marcus@");
    expect(text).not.toContain("lead@");
    expect(text).not.toContain("hidden@");
    expect(text).not.toContain("applied@");
    expect(text).not.toContain("555-0142");
    expect(text).not.toContain("555-0199");
    expect(text).not.toContain("private note");
    expect(text).not.toContain("do not print");
    expect(text).not.toContain("super-secret-service-role-key");
    expect(text).toContain('"applied": []');
    expect(run).toHaveBeenCalledWith(
      { type: "system", name: "won-backfill" },
      { apply: false, preview: true, acknowledgeProduction: true },
    );
  });

  it("keeps dry-run on the existing call and does not print the preview banner", async () => {
    run.mockResolvedValue({
      payingCount: 0,
      actions: [],
      target: "staging",
      apply: false,
      applied: [],
      roster: { clients: [], leads: [] },
    });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    await main(["node", "backfill-won-clients.ts", "--dry-run"]);
    const text = lines.join("\n");
    expect(text).not.toContain("READ ONLY, nothing written");
    expect(text).toContain('"mode": "dry-run"');
    expect(run).toHaveBeenCalledWith({ type: "system", name: "won-backfill" }, { apply: false, confirmUrl: undefined });
  });

  it("formatPreviewOutput drops contact fields even when the plan object has them", () => {
    const result = previewResult();
    (result.roster.leads[0] as { notes?: string }).notes = "secret note";
    const text = formatPreviewOutput(result);
    expect(text).toContain("mode: preview");
    expect(text).toContain("READ ONLY, nothing written");
    expect(text).not.toContain("secret note");
    expect(text).not.toMatch(/"notes":/);
  });
});
