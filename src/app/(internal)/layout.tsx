import type { ReactNode } from "react";
import { requireOwner } from "@/platform/auth/actor";
import { getAppSettings } from "@/platform/env";
import { listClientOptions } from "@/domains/work/service";
import type { ClientOption } from "@/domains/work/types";
import { AppShell } from "@/ui/shell/AppShell";
import { signOutAction } from "../(auth)/actions";

export default async function InternalLayout({ children }: { children: ReactNode }) {
  const actor = await requireOwner();
  const { appEnv } = getAppSettings();
  let clients: ClientOption[] = [];
  let clientsError = false;
  try {
    clients = await listClientOptions(actor);
  } catch (e) {
    // A failed list must not block Settings or sign-out; Quick Add shows a message instead.
    console.error("quick add client list failed", e);
    clientsError = true;
  }
  return (
    <AppShell env={appEnv} email={actor.email} signOut={signOutAction} clients={clients} clientsError={clientsError}>
      {children}
    </AppShell>
  );
}
