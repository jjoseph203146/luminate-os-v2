// Won backfill. Dry-run by default. --apply writes only when APP_ENV is local or staging
// AND the database is confirmed. --preview is the only mode that may run when APP_ENV is production,
// and it only reads. See docs/architecture/19-lead-client-link.md.
//
//   APP_ENV=staging npm run backfill:won -- --dry-run
//   APP_ENV=staging npm run backfill:won -- --apply --confirm-url="$NEXT_PUBLIC_SUPABASE_URL"
//   APP_ENV=production NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<key-on-this-machine> \
//     npm run backfill:won -- --preview --i-know-this-is-production
//
// The plan is built in src/domains/growth. This file parses the flags and prints the result.
// It prints business names and ids so the list can be checked. It does not print emails, phones, or notes.
import { pathToFileURL } from "node:url";
import { parseBackfillMode } from "@/domains/growth/rules";
import { runWonBackfill, type WonBackfillResult } from "@/domains/growth/service";
import type { WonBackfillAction } from "@/domains/growth/rules";

const HELP = `Won backfill — link or create clients for paying clients, and for Won leads that are not linked yet.

Usage:
  APP_ENV=staging npm run backfill:won -- --dry-run
  APP_ENV=staging npm run backfill:won -- --apply --confirm-url=<NEXT_PUBLIC_SUPABASE_URL>
  APP_ENV=staging BACKFILL_ALLOWED_PROJECT_REF=<ref> npm run backfill:won -- --apply
  APP_ENV=production NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<prod-key> npm run backfill:won -- --preview --i-know-this-is-production

--dry-run is the default. It reads and prints a plan. It writes nothing.
--apply writes. A second run writes nothing new.
--preview reads and prints the plan. It writes nothing. It is the only mode allowed when APP_ENV is production.

Use only one of --dry-run, --apply, or --preview.

Refuses --dry-run and --apply unless APP_ENV is local or staging. Unset and production both refuse,
even when --confirm-url matches. --confirm-url does not authorize a production preview or a production apply.

--apply also refuses unless one of these is true:
  --confirm-url is exactly NEXT_PUBLIC_SUPABASE_URL (a trailing slash is ignored), or
  BACKFILL_ALLOWED_PROJECT_REF lists that URL's project ref (the part before .supabase.co).
  Several refs are separated by commas.

Production preview needs both --preview and --i-know-this-is-production.
Set NEXT_PUBLIC_SUPABASE_URL to https://<prod-ref>.supabase.co and SUPABASE_SERVICE_ROLE_KEY to that
project's service-role key. The key stays on your machine. Do not commit it or put it in Vercel.
The banner prints the project ref, not the key.

Needs migration 0011 applied on that database first. This script does not apply it.
`;

const ACTOR = { type: "system" as const, name: "won-backfill" };

function safeAction(action: WonBackfillAction): WonBackfillAction {
  switch (action.op) {
    case "already":
      return { op: "already", leadId: action.leadId, clientId: action.clientId };
    case "mark_won":
      return { op: "mark_won", leadId: action.leadId, clientId: action.clientId };
    case "link":
      return { op: "link", leadId: action.leadId, clientId: action.clientId, how: action.how, markWon: action.markWon };
    case "create_client":
      return { op: "create_client", leadId: action.leadId };
    case "ambiguous":
      return { op: "ambiguous", clientId: action.clientId, leadIds: [...action.leadIds], how: action.how };
    case "ambiguous_lead":
      return { op: "ambiguous_lead", leadId: action.leadId, clientIds: [...action.clientIds], how: action.how };
    case "unmatched_client":
      return { op: "unmatched_client", clientId: action.clientId };
  }
}

function countActions(actions: readonly WonBackfillAction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const action of actions) counts[action.op] = (counts[action.op] ?? 0) + 1;
  return counts;
}

/** Banner plus the plan. Business names and ids only. Emails, phones, and notes are dropped. */
export function formatPreviewOutput(result: WonBackfillResult): string {
  const ref = result.projectRef && result.projectRef.trim() ? result.projectRef : "unavailable";
  const banner = ["mode: preview", `target project ref: ${ref}`, "READ ONLY, nothing written"].join("\n");
  const actions = result.actions.map(safeAction);
  const body = {
    mode: "preview" as const,
    target: result.target,
    payingCount: result.payingCount,
    counts: countActions(actions),
    actionNames: actions.map((action) => action.op),
    roster: {
      clients: result.roster.clients.map((client) => ({
        id: client.id,
        businessName: client.businessName,
        paying: client.paying,
        archived: client.archived,
      })),
      leads: result.roster.leads.map((lead) => ({
        id: lead.id,
        businessName: lead.businessName,
        stage: lead.stage,
        clientId: lead.clientId,
      })),
    },
    actions,
    applied: [] as [],
  };
  return `${banner}\n\n${JSON.stringify(body, null, 2)}`;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const parsed = parseBackfillMode(argv);
  if (parsed.mode === "preview") {
    const result = await runWonBackfill(ACTOR, { apply: false, preview: true, acknowledgeProduction: parsed.acknowledgeProduction });
    console.log(formatPreviewOutput(result));
    return;
  }
  const result = await runWonBackfill(ACTOR, { apply: parsed.mode === "apply", confirmUrl: parsed.confirmUrl });
  console.log(JSON.stringify({ mode: parsed.mode, target: result.target, payingCount: result.payingCount, roster: result.roster, actions: result.actions, applied: result.applied }, null, 2));
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "The Won backfill failed.");
    process.exit(1);
  });
}
