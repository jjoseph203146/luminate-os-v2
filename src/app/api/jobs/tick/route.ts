import { after } from "next/server";
import { tick } from "@/domains/automation/service";
import { getCronSecret } from "@/platform/env";
import { tickAuthorized } from "@/platform/jobs/auth";

export const dynamic = "force-dynamic";
// The jobs run after the response (see below) but inside this function's time limit.
export const maxDuration = 60;

// The one scheduler entry point (docs/architecture/04 s5). Vercel Cron calls
// GET with "Authorization: Bearer $CRON_SECRET"; other schedulers may POST.
async function handle(request: Request): Promise<Response> {
  const secret = getCronSecret();
  if (!secret) return Response.json({ error: "Scheduler is not configured." }, { status: 503 });
  if (!tickAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  // Answer at once and do the work after the response: the jobs (site checks, speed checks) can take longer
  // than a scheduler waits (cron-job.org's free plan waits 30 s), and a slow answer would look like a failure.
  // Results are recorded per job and shown on the Automations page.
  after(async () => {
    try {
      await tick({ type: "system", name: "scheduler" });
    } catch (e) {
      console.error("tick failed", e instanceof Error ? e.message : "unknown error");
    }
  });
  return Response.json({ accepted: true }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
