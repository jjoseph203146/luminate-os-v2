// The read-only tools the AI assistant can call (through /api/mcp). Each one reads through an existing domain
// service as the `ai` actor, then maps the result with an explicit allow-list (shape.ts).
// The service layer (service.ts) adds the permission check, strict argument validation, masking of
// sensitive-looking text, a size cap and an audit line, so a tool only has to read and shape.
import { z } from "zod";
import { getClientWorkspace, listClients } from "@/domains/clients/service";
import { getGrowthOverview } from "@/domains/growth/service";
import { getMonitoringOverview } from "@/domains/monitoring/service";
import { getToday } from "@/domains/today/service";
import { getWorkOverview } from "@/domains/work/service";
import {
  shapeAttention,
  shapeClientChoices,
  shapeClientWorkspace,
  shapeExpiring,
  shapeFinancialSummary,
  shapeLeads,
  shapeOpenRequests,
  shapeSiteIssues,
  shapeSites,
} from "./shape";
import type { ToolDef } from "./types";

const ATTENTION_MAX = 25;

const attentionShape = {
  limit: z.number().int().min(1).max(ATTENTION_MAX).optional().describe(`How many items to return, most urgent first. Default and maximum ${ATTENTION_MAX}.`),
};
const sitesShape = {
  only_problems: z.boolean().optional().describe("Only sites that are not up, are stale, or have an SSL certificate or domain expiring within 14 days."),
  include_muted: z.boolean().optional().describe("Also include sites of archived, on-hold or monitoring-stopped clients. Default false."),
};
const clientShape = { name: z.string().trim().min(1).max(120).describe('Business name, or part of it, e.g. "Busy B" or "Busy B Construction".') };
const issuesShape = { client: z.string().trim().min(1).max(120).optional().describe("Only errors for this client (business name, or part of it).") };
const requestsShape = { include_tasks: z.boolean().optional().describe("Also include the owner's internal tasks. Default false.") };
const expiringShape = { days: z.number().int().min(1).max(120).optional().describe("Look ahead this many days. Default 30, maximum 120.") };

export const TOOLS: ToolDef[] = [
  {
    name: "list_needs_attention",
    title: "What needs attention today",
    description:
      "Start here for \"what should I look at today?\". A ranked list (critical, warning, info) of what needs the owner: failed payments, past-due clients, sites down, slow or not checked recently, client requests waiting too long, overdue tasks and project blockers. Also lists items waiting on others. Returns the most urgent first, with the client, an explanation and how long it has been waiting.",
    inputShape: attentionShape,
    run: async (actor, args) => {
      const { limit } = z.object(attentionShape).parse(args);
      return shapeAttention(await getToday(actor), new Date(), limit ?? ATTENTION_MAX);
    },
  },
  {
    name: "list_sites",
    title: "List monitored sites",
    description:
      "Every monitored client website: status (up, slow, down, unknown), whether the last check is stale (over an hour old), response time, HTTP status, security score (higher is better), broken links, days left on the SSL certificate and the domain, when it was last checked. Use for questions about uptime, which sites are down, or site health. Sites of archived, on-hold or monitoring-stopped clients are hidden unless include_muted is true.",
    inputShape: sitesShape,
    run: async (actor, args) => {
      const a = z.object(sitesShape).parse(args);
      return shapeSites(await getMonitoringOverview(actor), new Date(), { onlyProblems: a.only_problems === true, includeMuted: a.include_muted === true });
    },
  },
  {
    name: "get_client",
    title: "Get one client in detail",
    description:
      "One client by business name (partial names work): status, plan and monthly price, how its website is doing, open requests with days open, the last payments (amount, status, date) and its projects (contract status, launch date, whether something is blocking). Contact details, notes and documents are never included. If several clients match, it lists their names so you can ask again.",
    inputShape: clientShape,
    run: async (actor, args) => {
      const { name } = z.object(clientShape).parse(args);
      // The directory search also matches contact names, emails and phone numbers. Keep only matches on the
      // business name, so this tool can never be used to find out who owns an email address or phone number.
      const needle = name.trim().toLowerCase();
      const found = (await listClients(actor, { search: name })).filter((c) => c.businessName.toLowerCase().includes(needle));
      if (found.length === 0) return { found: false, message: "No client matches that name.", matches: [] };
      const exact = found.filter((c) => c.businessName.trim().toLowerCase() === name.toLowerCase());
      const pick = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : undefined;
      if (!pick) return { found: false, message: "Several clients match. Ask again with one of these names.", matches: shapeClientChoices(found) };
      const workspace = await getClientWorkspace(actor, pick.id);
      if (!workspace) return { found: false, message: "No client matches that name.", matches: [] };
      return shapeClientWorkspace(workspace, new Date());
    },
  },
  {
    name: "list_site_issues",
    title: "Site errors",
    description:
      "Open runtime errors captured in client websites (the most recent 50): the client, the error title, its level and when it was last seen, with a link to the report. Use for \"are any client sites throwing errors?\". Resolved or ignored errors are not shown.",
    inputShape: issuesShape,
    run: async (actor, args) => {
      const { client } = z.object(issuesShape).parse(args);
      return shapeSiteIssues(await getMonitoringOverview(actor), client ?? null);
    },
  },
  {
    name: "list_open_requests",
    title: "Open requests and work",
    description:
      "Open client requests: request number, client, title, status, priority, days open, and whether it is waiting on the client. Optionally also the owner's own internal tasks (title, status, priority, due date, overdue). Titles only: no descriptions or comments.",
    inputShape: requestsShape,
    run: async (actor, args) => {
      const { include_tasks } = z.object(requestsShape).parse(args);
      return shapeOpenRequests(await getWorkOverview(actor), new Date(), include_tasks === true);
    },
  },
  {
    name: "list_expiring",
    title: "Expiring SSL certificates and domains",
    description:
      "SSL certificates and domain registrations that expire within N days or have already expired, soonest first, with the client, the site and the days left (negative means already expired). Use for \"what expires soon?\".",
    inputShape: expiringShape,
    run: async (actor, args) => {
      const { days } = z.object(expiringShape).parse(args);
      return shapeExpiring(await getMonitoringOverview(actor), new Date(), days ?? 30);
    },
  },
  {
    name: "get_financial_summary",
    title: "Financial summary",
    description:
      "Money figures for this month: the monthly plan total (the sum of plan prices, NOT collected money), what has been paid this month and how many payments, the latest payment time, failed payments in the last 30 days and pending payments. Each figure comes with its meaning. Expenses, net profit and per-invoice detail are not available here and are listed as unavailable: never estimate them.",
    inputShape: {},
    run: async (actor) => shapeFinancialSummary(await getToday(actor)),
  },
  {
    name: "list_leads",
    title: "Open leads",
    description:
      "The open sales pipeline: business name, stage, source, estimated value and follow-up date (overdue, today or upcoming), soonest follow-up first, plus totals (pipeline value, follow-ups due, proposals out, won and lost, win rate). Pipeline value is deal value, never revenue. Names, emails, phone numbers and notes are never included.",
    inputShape: {},
    run: async (actor) => shapeLeads(await getGrowthOverview(actor)),
  },
];
