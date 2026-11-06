// Clients domain: the only entry point for the directory and the client workspace.
// Read-only in M1. Every function takes an actor and checks permission first.
import { z } from "zod";
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { readDb } from "@/platform/db/server";
import { cleanSearch, parseStatusFilter } from "./rules";
import * as repo from "./repo";
import type { ClientListItem, ClientWorkspace } from "./types";

const idSchema = z.string().uuid();

export async function listClients(
  actor: Actor,
  input: { search?: string | null; status?: string | null; includeArchived?: boolean },
): Promise<ClientListItem[]> {
  assertCan(actor, "clients.read");
  const db = await readDb(actor);
  return repo.listClients(
    db,
    {
      search: cleanSearch(input.search),
      status: parseStatusFilter(input.status),
      includeArchived: input.includeArchived === true,
    },
    new Date(),
  );
}

/** Returns null when the id is not a valid id or the client does not exist. */
export async function getClientWorkspace(actor: Actor, id: string): Promise<ClientWorkspace | null> {
  assertCan(actor, "clients.read");
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return null;
  const db = await readDb(actor);
  return repo.getClientWorkspace(db, parsed.data, new Date());
}
