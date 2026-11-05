"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { QuickAdd, type QuickAddMode } from "@/ui/QuickAdd";
import type { ClientOption } from "@/domains/work/types";

type Opener = (mode?: QuickAddMode, clientId?: string) => void;
const Ctx = createContext<Opener>(() => {});

export function useQuickAdd(): Opener {
  return useContext(Ctx);
}

/** Holds the Quick add sheet so the button in the header, the phone button and any "+ Task" link share it. */
export function QuickAddProvider({
  clients,
  clientsError,
  children,
}: {
  clients: ClientOption[];
  clientsError: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState<{ open: boolean; mode: QuickAddMode; clientId: string; round: number }>({
    open: false,
    mode: "request",
    clientId: "",
    round: 0,
  });
  const open = useCallback<Opener>((mode = "request", clientId = "") => {
    setState((s) => ({ ...s, open: true, mode, clientId }));
  }, []);
  const close = useCallback(() => {
    // Changing `round` remounts the forms, so each opening starts blank with a fresh task key.
    setState((s) => ({ ...s, open: false, round: s.round + 1 }));
  }, []);
  const value = useMemo(() => open, [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <QuickAdd
        key={state.round}
        open={state.open}
        onClose={close}
        initialMode={state.mode}
        initialClientId={state.clientId}
        clients={clients}
        clientsError={clientsError}
      />
    </Ctx.Provider>
  );
}
