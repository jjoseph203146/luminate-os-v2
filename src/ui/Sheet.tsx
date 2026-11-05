"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Bottom sheet on phones, centred panel on desktop, built on the native <dialog>
 * (focus trap, Escape to close and the backdrop come from the browser).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40 md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:h-full md:w-[26rem] md:rounded-none md:rounded-l-2xl"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg text-sm text-muted">
          Close
        </button>
      </div>
      <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{children}</div>
    </dialog>
  );
}
