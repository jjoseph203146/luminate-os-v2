"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Quick-add container: bottom sheet on phones, centred 560px dialog from md up.
 * Built on the native <dialog> (focus trap, Escape to close and the backdrop come from the browser).
 * `header` is extra header content under the title row (e.g. the Request/Task switch).
 */
export function Sheet({
  open,
  onClose,
  title,
  header,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  header?: ReactNode;
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
      className="lx-up fixed inset-x-0 bottom-0 top-auto m-0 max-h-[93dvh] w-full max-w-none flex-col rounded-t-[22px] border-0 bg-surface p-0 text-ink backdrop:bg-overlay open:flex md:inset-0 md:m-auto md:max-h-[88dvh] md:w-[560px] md:rounded-2xl md:shadow-[0_24px_64px_rgba(13,27,46,.28)]"
    >
      <div className="flex flex-none flex-col gap-2.5 border-b border-line px-4 pb-3 pt-2">
        <div aria-hidden="true" className="h-[5px] w-9 self-center rounded-[3px] bg-line2 md:hidden" />
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[17px] font-semibold">{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2.5 grid h-11 w-11 place-items-center">
            <Icon name="close" size={24} />
          </button>
        </div>
        {header}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </dialog>
  );
}
