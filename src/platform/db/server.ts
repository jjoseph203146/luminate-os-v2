// Database clients. Server-only: never import this from a client component.
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPublicEnv, getServiceRoleKey } from "@/platform/env";

export type Db = ReturnType<typeof createAdminClient>;

/** Runs as the signed-in user, so row-level security applies. */
export async function createUserClient() {
  // Reading cookies first marks the page as dynamic, so it is never prerendered at build time.
  const cookieStore = await cookies();
  const env = getPublicEnv();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which cannot set cookies. The proxy refreshes the session.
        }
      },
    },
  });
}

/**
 * The database client for a READ on behalf of this actor.
 * - owner: the signed-in user's client, so row-level security applies.
 * - ai, system: no session exists, so the service-role client is used. Callers must check the actor's
 *   permission first (assertCan), and the ai actor only reaches these reads through the fixed,
 *   read-only tool list in domains/assistant.
 */
export async function readDb(actor: { type: string }) {
  if (actor.type === "owner") return createUserClient();
  if (actor.type === "ai" || actor.type === "system") return createAdminClient();
  throw new Error("This actor cannot read data");
}

/**
 * Service-role client. Bypasses row-level security, so it is used only by
 * platform code (audit writes, jobs, user administration), always with an
 * explicit actor, and never for reads on behalf of a page.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") throw new Error("Admin client is server-only");
  const env = getPublicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, getServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
