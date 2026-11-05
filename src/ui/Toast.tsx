"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type ToastInput = { message: string; undo?: () => void | Promise<void> };
const Ctx = createContext<(t: ToastInput) => void>(() => {});

export function useToast(): (t: ToastInput) => void {
  return useContext(Ctx);
}

/** One short confirmation at a time, with an optional Undo. Lives in the shell so it survives page refreshes. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastInput | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((t: ToastInput) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), 7000);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && (
        <div
          role="status"
          className="lx-up fixed bottom-[calc(58px+max(26px,env(safe-area-inset-bottom))+16px)] left-4 right-4 z-[90] md:bottom-6 md:left-1/2 md:right-auto md:-ml-[190px] md:w-[380px]"
        >
          <div className="flex min-h-12 items-center gap-2.5 rounded-xl bg-hero py-2.5 pl-3.5 pr-2.5 text-[14px] text-white shadow-[0_12px_32px_rgba(13,27,46,.3)]">
            <span className="text-[#8FE0B8]"><Icon name="check_circle" size={20} /></span>
            <span className="flex-1">{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                onClick={() => {
                  const undo = toast.undo;
                  setToast(null);
                  void undo?.();
                }}
                className="h-[34px] rounded-lg bg-white/[.12] px-2.5 text-[14px] font-semibold text-white"
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
