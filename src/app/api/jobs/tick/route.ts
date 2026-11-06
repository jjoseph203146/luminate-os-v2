import { tick } from "@/domains/automation/service";
import { getCronSecret } from "@/platform/env";
import { tickAuthorized } from "@/platform/jobs/auth";

export const dynamic = "force-dynamic";
// The site scan job checks every client site inside one tick, so the function needs more than the default time.
export const maxDuration = 60;

// The one scheduler entry point (docs/architecture/04 s5). Vercel Cron calls
// GET with "Authorization: Bearer $CRON_SECRET"; other schedulers may POST.
async function handle(request: Request): Promise<Response> {
  const secret = getCronSecret();
  if (!secret) return Response.json({ error: "Scheduler is not configured." }, { status: 503 });
  if (!tickAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return Response.json(await tick({ type: "system", name: "scheduler" }));
  } catch (e) {
    console.error("tick failed", e);
    return Response.json({ error: "Tick failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
