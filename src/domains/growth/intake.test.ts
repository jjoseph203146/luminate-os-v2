import { describe, expect, it } from "vitest";
import { isHoneypotFilled, leadInputFromRaw, leadNotification, NOT_GIVEN } from "./intake";

describe("leadInputFromRaw", () => {
  it("accepts the basic fields and defaults a missing business name", () => {
    const r = leadInputFromRaw({ name: " Jane  Smith ", email: "Jane@Acme.COM", message: "Need a site" });
    expect(r).toEqual({ ok: true, value: { name: "Jane Smith", businessName: NOT_GIVEN, email: "jane@acme.com", phone: "", notes: "Need a site" } });
  });
  it("understands alternative field names", () => {
    const r = leadInputFromRaw({ full_name: "A B", company: "Acme", phone_number: "(803) 555-0100", details: "hi" });
    expect(r.ok && r.value).toMatchObject({ name: "A B", businessName: "Acme", phone: "(803) 555-0100", notes: "hi" });
  });
  it("needs a name and a way to reach the person", () => {
    expect(leadInputFromRaw({ email: "a@b.co" }).ok).toBe(false);
    const r = leadInputFromRaw({ name: "A" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.join(" ")).toContain("email address or a phone number");
  });
  it("rejects a bad email, a lone short phone and over-long text", () => {
    expect(leadInputFromRaw({ name: "A", email: "nope" }).ok).toBe(false);
    expect(leadInputFromRaw({ name: "A", phone: "123" }).ok).toBe(false);
    expect(leadInputFromRaw({ name: "A", email: "a@b.co", notes: "x".repeat(5001) }).ok).toBe(false);
    expect(leadInputFromRaw({ name: "A", email: "a@b.co", notes: "x".repeat(5000) }).ok).toBe(true);
    expect(leadInputFromRaw({ name: "x".repeat(101), email: "a@b.co" }).ok).toBe(false);
  });
  it("strips control characters and keeps message line breaks", () => {
    const r = leadInputFromRaw({ name: "A\u0000B", email: "a@b.co", message: "line1\r\nline2\u0007" });
    expect(r.ok && r.value.name).toBe("AB");
    expect(r.ok && r.value.notes).toBe("line1\nline2");
  });
  it("ignores non-string junk", () => {
    expect(leadInputFromRaw({ name: { a: 1 }, email: "a@b.co" }).ok).toBe(false);
  });
});

describe("leadInputFromRaw: what the marketing site sends", () => {
  const website = { name: "Jane", businessName: "Acme", email: "jane@acme.com", phone: "555-0100", projectType: "New website", message: "Need a site" };
  it("keeps the project type in the notes, like the old app did", () => {
    const r = leadInputFromRaw(website);
    expect(r.ok && r.value).toMatchObject({ name: "Jane", businessName: "Acme", phone: "555-0100", notes: "Project type: New website\n\nNeed a site" });
  });
  it("works with a project type and no message, or a message and no project type", () => {
    const typeOnly = leadInputFromRaw({ ...website, message: "" });
    expect(typeOnly.ok && typeOnly.value.notes).toBe("Project type: New website");
    const r = leadInputFromRaw({ ...website, projectType: "" });
    expect(r.ok && r.value.notes).toBe("Need a site");
  });
  it("keeps a short or odd phone number as typed when there is a good email", () => {
    const r = leadInputFromRaw({ ...website, phone: "n/a" });
    expect(r.ok && r.value.phone).toBe("n/a");
  });
  it("still needs email, or a phone with at least 7 digits", () => {
    expect(leadInputFromRaw({ name: "A", phone: "n/a" }).ok).toBe(false);
    expect(leadInputFromRaw({ name: "A", phone: "803 555 0100" }).ok).toBe(true);
  });
  it("caps the project type", () => {
    expect(leadInputFromRaw({ ...website, projectType: "x".repeat(81) }).ok).toBe(false);
  });
});

describe("isHoneypotFilled", () => {
  it("is true only when a trap field has text", () => {
    expect(isHoneypotFilled({ _gotcha: "x" })).toBe(true);
    expect(isHoneypotFilled({ hp: "  " })).toBe(false);
    expect(isHoneypotFilled({ name: "x" })).toBe(false);
  });
});

describe("leadNotification", () => {
  it("names the lead, the business and the contact, and links to the lead", () => {
    const p = leadNotification({ id: "abc", name: "Jane", businessName: "Acme", email: "j@a.co", phone: "", notes: "Need a site" });
    expect(p).toEqual({ title: "New lead: Jane - Acme", body: "j@a.co - Need a site", url: "/growth?lead=abc", tag: "lead-abc" });
  });
  it("leaves out a business name that was not given and falls back to the phone", () => {
    const p = leadNotification({ id: "x", name: "Jane", businessName: NOT_GIVEN, email: "", phone: "555 0100", notes: "" });
    expect(p.title).toBe("New lead: Jane");
    expect(p.body).toBe("555 0100");
  });
});
