import type { JobHandler } from "./runner";

// One handler per row in the jobs table. Business jobs arrive in later phases.
export const handlers: Record<string, JobHandler> = {
  // Does no business work. Its recent runs prove the scheduler is calling the app.
  heartbeat: async ({ now }) => ({ ok: true, at: now.toISOString() }),
};
