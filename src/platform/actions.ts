// Wrapper for server actions: runs the work and returns a message for the form.
import { unstable_rethrow } from "next/navigation";
import { toActionError } from "@/platform/action-errors";
import type { ActionState } from "@/ui/action-state";

/** Call requireOwner() BEFORE this, so a redirect is never swallowed here. */
export async function runAction(work: () => Promise<void>, okMessage: string): Promise<ActionState> {
  try {
    await work();
    return { status: "ok", message: okMessage };
  } catch (e) {
    unstable_rethrow(e);
    const known = toActionError(e);
    if (known === "Something went wrong. Please try again.") console.error("action failed", e);
    return { status: "error", message: known };
  }
}
