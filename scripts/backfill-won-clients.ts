// Won backfill. Dry-run by default. Writes only with --apply, and only when APP_ENV is
// local or staging. Do not point this at production. See docs/architecture/19-lead-client-link.md.
//
//   npm run backfill:won -- --dry-run
//   APP_ENV=staging npm run backfill:won -- --apply
//
// The plan is built in src/domains/growth. This file only parses the flag and prints the result.
// It prints business names and ids so the list can be checked. It does not print emails, phones, or notes.
import { pathToFileURL } from "node:url";
import { runWonBackfill } from "@/domains/growth/service";

const HELP = `Won backfill — link or create clients for paying clients, and for Won leads that are not linked yet.

Usage:
  npm run backfill:won -- --dry-run
  npm run backfill:won -- --apply

--dry-run is the default. It reads and prints a plan. It writes nothing.
--apply writes. A second run writes nothing new.

Refuses to run unless APP_ENV is local or staging. Unset and production both refuse.
That check does not prove the Supabase URL is the staging project. Do not point
NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY at production.

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
  const result = await runWonBackfill({ type: "system", name: "won-backfill" }, { apply: mode === "apply" });
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
