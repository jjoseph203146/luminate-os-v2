import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  getClientForChange: vi.fn(),
  updateClient: vi.fn(),
  logActivity: vi.fn(),
  listWebsites: vi.fn(),
  insertWebsite: vi.fn(),
  updateWebsite: vi.fn(),
  deleteWebsite: vi.fn(),
  listProjectUrls: vi.fn(),
  setProjectProductionUrl: vi.fn(),
}));
vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/platform/db/server", () => ({ readDb: async () => ({}), createAdminClient: () => ({}), createUserClient: async () => ({}) }));
vi.mock("./repo", () => ({
  getClientForChange: mocks.getClientForChange,
  updateClient: mocks.updateClient,
  logActivity: mocks.logActivity,
  listWebsites: mocks.listWebsites,
  insertWebsite: mocks.insertWebsite,
  updateWebsite: mocks.updateWebsite,
  deleteWebsite: mocks.deleteWebsite,
  listProjectUrls: mocks.listProjectUrls,
  setProjectProductionUrl: mocks.setProjectProductionUrl,
}));

import { addClientWebsite, removeClientWebsite, setClientFlag, setProjectUrl, updateClientDetails, updateClientWebsite } from "./service";
import { PermissionError, RuleError, ValidationError } from "@/platform/errors";
import type { Actor } from "@/platform/auth/types";

const ID = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const SITE2 = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const owner: Actor = { type: "owner", userId: "owner-1", email: null, ip: null };
const others: Actor[] = [
  { type: "ai", name: "assistant" },
  { type: "system", name: "jobs" },
  { type: "integration", name: "stripe" },
];
const NOW = new Date("2026-11-06T10:00:00.000Z");

const client = (over: Record<string, unknown> = {}) => ({
  id: ID,
  business_name: "Acme",
  contact_name: "Ann",
  email: "ann@acme.test",
  phone: null,
  plan_name: "Basic",
  client_since: null,
  revisions_included: 2,
  archived_at: null,
  on_hold_since: null,
  monitoring_paused_at: null,
  ...over,
});
const site = (id: string, url: string, label = "Production") => ({ id, label, url, created_at: "2026-01-01T00:00:00Z" });
const details = (over: Record<string, unknown> = {}) => ({
  clientId: ID,
  businessName: "Acme",
  contactName: "Ann",
  email: "ann@acme.test",
  phone: "",
  planName: "Basic",
  clientSince: "",
  revisionsIncluded: "2",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAudit.mockResolvedValue(undefined);
  mocks.getClientForChange.mockResolvedValue(client());
  mocks.updateClient.mockResolvedValue(true);
  mocks.listWebsites.mockResolvedValue([site(SITE, "https://acme.test")]);
  mocks.insertWebsite.mockImplementation(async (_db, _c, label: string, url: string) => ({ id: SITE2, label, url, created_at: "2026-11-06T00:00:00Z" }));
  mocks.updateWebsite.mockResolvedValue(true);
  mocks.deleteWebsite.mockResolvedValue(true);
  mocks.listProjectUrls.mockResolvedValue([{ id: PROJECT, production_url: null, created_at: "2026-01-01T00:00:00Z" }]);
  mocks.setProjectProductionUrl.mockResolvedValue(true);
});

describe("permissions", () => {
  it("refuses every non-owner actor before reading anything", async () => {
    for (const actor of others) {
      await expect(setClientFlag(actor, { clientId: ID, flag: "on_hold", on: "1" })).rejects.toBeInstanceOf(PermissionError);
      await expect(updateClientDetails(actor, details())).rejects.toBeInstanceOf(PermissionError);
      await expect(addClientWebsite(actor, { clientId: ID, url: "b.test" })).rejects.toBeInstanceOf(PermissionError);
      await expect(updateClientWebsite(actor, { clientId: ID, websiteId: SITE, url: "b.test" })).rejects.toBeInstanceOf(PermissionError);
      await expect(removeClientWebsite(actor, { clientId: ID, websiteId: SITE, confirm: "on" })).rejects.toBeInstanceOf(PermissionError);
      await expect(setProjectUrl(actor, { clientId: ID, projectId: PROJECT, url: "b.test" })).rejects.toBeInstanceOf(PermissionError);
    }
    expect(mocks.getClientForChange).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

describe("setClientFlag", () => {
  it("archives with confirmation, logs activity in the old format and writes an audit row", async () => {
    const r = await setClientFlag(owner, { clientId: ID, flag: "archived", on: "1", confirm: "on" }, () => NOW);
    expect(r.changed).toBe(true);
    expect(mocks.updateClient).toHaveBeenCalledWith({}, ID, { archived_at: NOW.toISOString() });
    expect(mocks.logActivity).toHaveBeenCalledWith({}, ID, "client", ID, "client_archived");
    expect(mocks.writeAudit).toHaveBeenCalledWith(owner, expect.objectContaining({ action: "client.archived", entityId: ID, before: { archived_at: null }, after: { archived_at: NOW.toISOString() } }));
  });
  it("needs the confirmation box to archive, but not to restore", async () => {
    await expect(setClientFlag(owner, { clientId: ID, flag: "archived", on: "1" })).rejects.toBeInstanceOf(RuleError);
    expect(mocks.updateClient).not.toHaveBeenCalled();
    mocks.getClientForChange.mockResolvedValueOnce(client({ archived_at: "2026-01-01T00:00:00Z" }));
    await setClientFlag(owner, { clientId: ID, flag: "archived", on: "0" });
    expect(mocks.updateClient).toHaveBeenCalledWith({}, ID, { archived_at: null });
    expect(mocks.logActivity).toHaveBeenCalledWith({}, ID, "client", ID, "client_restored");
  });
  it("is idempotent: already on keeps the original date and writes nothing", async () => {
    mocks.getClientForChange.mockResolvedValue(client({ on_hold_since: "2026-01-01T00:00:00Z", monitoring_paused_at: "2026-02-01T00:00:00Z" }));
    expect(await setClientFlag(owner, { clientId: ID, flag: "on_hold", on: "1" })).toEqual({ message: "This client is already on hold.", changed: false });
    expect(await setClientFlag(owner, { clientId: ID, flag: "monitoring_paused", on: "true" })).toMatchObject({ changed: false });
    mocks.getClientForChange.mockResolvedValue(client());
    expect(await setClientFlag(owner, { clientId: ID, flag: "on_hold", on: "0" })).toMatchObject({ changed: false });
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
  it("puts on hold / stops monitoring with the old activity names", async () => {
    await setClientFlag(owner, { clientId: ID, flag: "on_hold", on: "1" }, () => NOW);
    await setClientFlag(owner, { clientId: ID, flag: "monitoring_paused", on: "1" }, () => NOW);
    expect(mocks.updateClient).toHaveBeenCalledWith({}, ID, { on_hold_since: NOW.toISOString() });
    expect(mocks.updateClient).toHaveBeenCalledWith({}, ID, { monitoring_paused_at: NOW.toISOString() });
    expect(mocks.logActivity.mock.calls.map((c) => c[4])).toEqual(["client_on_hold", "monitoring_paused"]);
    expect(mocks.writeAudit.mock.calls.map((c) => c[1].action)).toEqual(["client.on_hold", "client.monitoring_paused"]);
  });
  it("refuses bad input, a missing client and an update that saved nothing", async () => {
    await expect(setClientFlag(owner, { clientId: "nope", flag: "on_hold", on: "1" })).rejects.toBeInstanceOf(ValidationError);
    await expect(setClientFlag(owner, { clientId: ID, flag: "status", on: "1" })).rejects.toBeInstanceOf(ValidationError);
    mocks.getClientForChange.mockResolvedValueOnce(null);
    await expect(setClientFlag(owner, { clientId: ID, flag: "on_hold", on: "1" })).rejects.toThrow("could not be found");
    mocks.updateClient.mockResolvedValueOnce(false);
    await expect(setClientFlag(owner, { clientId: ID, flag: "on_hold", on: "1" })).rejects.toThrow("Nothing was saved");
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

describe("updateClientDetails", () => {
  it("saves only the fields that changed; the audit row has before/after except contact details", async () => {
    const r = await updateClientDetails(owner, details({ businessName: "  Acme Ltd ", phone: "+1 (555) 010-2000", revisionsIncluded: "3" }));
    expect(r).toEqual({ message: "Client details saved.", changed: true });
    const patch = { business_name: "Acme Ltd", phone: "+1 (555) 010-2000", revisions_included: 3 };
    expect(mocks.updateClient).toHaveBeenCalledWith({}, ID, patch);
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        action: "client.details_updated",
        before: { business_name: "Acme", revisions_included: 2 },
        after: { business_name: "Acme Ltd", revisions_included: 3, changed: ["business_name", "phone", "revisions_included"] },
      }),
    );
    // Contact details never reach the audit log, only the fact that they changed.
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain("555");
  });
  it("writes nothing when nothing changed", async () => {
    expect(await updateClientDetails(owner, details())).toEqual({ message: "No changes to save.", changed: false });
    expect(mocks.updateClient).not.toHaveBeenCalled();
  });
  it("keeps the old placeholders: empty contact is Unknown, empty email is no-email", async () => {
    mocks.getClientForChange.mockResolvedValueOnce(client({ contact_name: "Unknown", email: "no-email" }));
    expect(await updateClientDetails(owner, details({ contactName: "", email: "" }))).toMatchObject({ changed: false });
    await updateClientDetails(owner, details({ contactName: "", email: "" }));
    expect(mocks.updateClient).toHaveBeenCalledWith({}, ID, { contact_name: "Unknown", email: "no-email" });
  });
  it("lowercases the email and clears empty optional fields", async () => {
    mocks.getClientForChange.mockResolvedValueOnce(client({ phone: "555 0100", plan_name: "Basic", client_since: "2024-01-01" }));
    await updateClientDetails(owner, details({ email: "ANN@Acme.test", phone: "", planName: "", clientSince: "" }));
    expect(mocks.updateClient).toHaveBeenCalledWith({}, ID, { phone: null, plan_name: null, client_since: null });
  });
  it("refuses an empty business name, a bad email, a bad phone, a bad date and a bad update count", async () => {
    for (const bad of [{ businessName: " " }, { email: "not-an-email" }, { phone: "call me" }, { clientSince: "03/01/2024" }, { revisionsIncluded: "-1" }, { revisionsIncluded: "1.5" }, { businessName: "x".repeat(121) }]) {
      await expect(updateClientDetails(owner, details(bad))).rejects.toBeInstanceOf(ValidationError);
    }
    expect(mocks.updateClient).not.toHaveBeenCalled();
  });
  it("never edits status, price or Stripe fields even if posted", async () => {
    await updateClientDetails(owner, details({ status: "active", subscriptionPrice: "0", stripe_customer_id: "cus_X", businessName: "New" }));
    expect(mocks.updateClient).toHaveBeenCalledWith({}, ID, { business_name: "New" });
  });
});

describe("websites", () => {
  it("adds an https website with the default label and an audit row", async () => {
    await addClientWebsite(owner, { clientId: ID, label: "", url: "New-Site.test/" });
    expect(mocks.insertWebsite).toHaveBeenCalledWith({}, ID, "Production", "https://new-site.test");
    expect(mocks.writeAudit).toHaveBeenCalledWith(owner, expect.objectContaining({ action: "client_website.added", entityId: SITE2, after: { label: "Production", url: "https://new-site.test" } }));
  });
  it("refuses http and duplicates of an existing website", async () => {
    await expect(addClientWebsite(owner, { clientId: ID, url: "http://b.test" })).rejects.toThrow("https://");
    await expect(addClientWebsite(owner, { clientId: ID, url: "https://www.acme.test/" })).rejects.toThrow("already listed");
    expect(mocks.insertWebsite).not.toHaveBeenCalled();
  });
  it("edits a website, refusing a duplicate of another one and a website from another client", async () => {
    mocks.listWebsites.mockResolvedValue([site(SITE, "https://acme.test"), site(SITE2, "https://shop.acme.test", "Shop")]);
    await updateClientWebsite(owner, { clientId: ID, websiteId: SITE, label: "Main", url: "https://acme.test" });
    expect(mocks.updateWebsite).toHaveBeenCalledWith({}, ID, SITE, { label: "Main", url: "https://acme.test" });
    await expect(updateClientWebsite(owner, { clientId: ID, websiteId: SITE, url: "shop.acme.test" })).rejects.toThrow("already listed");
    await expect(updateClientWebsite(owner, { clientId: ID, websiteId: PROJECT, url: "x.test" })).rejects.toThrow("could not be found");
    expect(await updateClientWebsite(owner, { clientId: ID, websiteId: SITE2, label: "Shop", url: "https://shop.acme.test" })).toMatchObject({ changed: false });
    expect(mocks.updateWebsite).toHaveBeenCalledTimes(1);
  });
  it("removes a website only with the confirmation box", async () => {
    await expect(removeClientWebsite(owner, { clientId: ID, websiteId: SITE })).rejects.toBeInstanceOf(RuleError);
    expect(mocks.deleteWebsite).not.toHaveBeenCalled();
    await removeClientWebsite(owner, { clientId: ID, websiteId: SITE, confirm: "on" });
    expect(mocks.deleteWebsite).toHaveBeenCalledWith({}, ID, SITE);
    expect(mocks.writeAudit).toHaveBeenCalledWith(owner, expect.objectContaining({ action: "client_website.removed", before: { label: "Production", url: "https://acme.test" } }));
  });
});

describe("setProjectUrl", () => {
  it("sets and clears the project's live address", async () => {
    await setProjectUrl(owner, { clientId: ID, projectId: PROJECT, url: "acme.test" });
    expect(mocks.setProjectProductionUrl).toHaveBeenCalledWith({}, ID, PROJECT, "https://acme.test");
    mocks.listProjectUrls.mockResolvedValueOnce([{ id: PROJECT, production_url: "https://acme.test", created_at: "2026-01-01T00:00:00Z" }]);
    expect((await setProjectUrl(owner, { clientId: ID, projectId: PROJECT, url: "" })).message).toContain("cleared");
    expect(mocks.setProjectProductionUrl).toHaveBeenLastCalledWith({}, ID, PROJECT, null);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(2);
  });
  it("refuses another client's project and an http address", async () => {
    await expect(setProjectUrl(owner, { clientId: ID, projectId: SITE, url: "acme.test" })).rejects.toThrow("could not be found");
    await expect(setProjectUrl(owner, { clientId: ID, projectId: PROJECT, url: "http://acme.test" })).rejects.toThrow("https://");
    expect(mocks.setProjectProductionUrl).not.toHaveBeenCalled();
  });
});
