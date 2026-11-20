// Won backfill. Dry-run by default. --apply writes only when APP_ENV is local or staging
// AND the database is confirmed. Do not point this at production.
// See docs/architecture/19-lead-client-link.md.
//
//   APP_ENV=staging npm run backfill:won -- --dry-run
//   APP_ENV=staging npm run backfill:won -- --apply --confirm-url="$NEXT_PUBLIC_SUPABASE_URL"
//
// The plan is built in src/domains/growth. This file parses the flags and prints the result.
// It prints business names and ids so the list can be checked. It does not print emails, phones, or notes.
import { pathToFileURL } from "node:url";
import { confirmUrlFromArgv } from "@/domains/growth/rules";
import { runWonBackfill } from "@/domains/growth/service";

const HELP = `Won backfill — link or create clients for paying clients, and for Won leads that are not linked yet.

Usage:
  APP_ENV=staging npm run backfill:won -- --dry-run
  APP_ENV=staging npm run backfill:won -- --apply --confirm-url=<NEXT_PUBLIC_SUPABASE_URL>
  APP_ENV=staging BACKFILL_ALLOWED_PROJECT_REF=<ref> npm run backfill:won -- --apply

--dry-run is the default. It reads and prints a plan. It writes nothing.
--apply writes. A second run writes nothing new.

Refuses to run unless APP_ENV is local or staging. Unset and production both refuse,
even when --confirm-url matches.

--apply also refuses unless one of these is true:
  --confirm-url is exactly NEXT_PUBLIC_SUPABASE_URL (a trailing slash is ignored), or
  BACKFILL_ALLOWED_PROJECT_REF lists that URL's project ref (the part before .supabase.co).
  Several refs are separated by commas.

Do not point NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY at production.

Needs migration 0011 applied on that database first. This script does not apply it.
`;

function flag(): "dry-run" | "apply" | "help" {
  const apply = process.argv.includes("--apply");
  const dry = process.argv.includes("--dry-run");
  if (process.argv.includes("--help") || process.argv.includes("-h")) return "help";
  if (apply && dry) {
    console.error("Use either --dry-run or --apply.");
    process.exitCode = 1;
    return "help";
  }
  return apply ? "apply" : "dry-run";
}

export async function main(): Promise<void> {
  const mode = flag();
  if (mode === "help") {
    console.log(HELP);
    return;
  }
  const confirmUrl = confirmUrlFromArgv(process.argv);
  const result = await runWonBackfill({ type: "system", name: "won-backfill" }, { apply: mode === "apply", confirmUrl });
  // Ids, counts, and action names only. Business names are not in this object.
  console.log(JSON.stringify({ mode, target: result.target, payingCount: result.payingCount, roster: result.roster, actions: result.actions, applied: result.applied }, null, 2));
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "The Won backfill failed.");
    process.exit(1);
  });
}
