"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Record panel. Full screen on phones; docked 392px on the right from lg up (the page
 * makes room for it, see `[data-record-panel]` in globals.css).
 * Closes with a link (`closeHref`, used for panels driven by the address) or `onClose`.
 */
export function Panel({
  label,
  closeHref,
  onClose,
  footer,
  children,
}: {
  label: string;
  closeHref?: string;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const close = () => {
    if (onClose) onClose();
    else if (closeHref) router.push(closeHref, { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, onClose]);

  const closeButton = "grid h-11 w-11 place-items-center rounded-[10px] text-ink";
  return (
    <aside
      role="dialog"
      aria-label={label}
      data-record-panel
      className="lx-panel fixed inset-0 z-40 flex flex-col bg-canvas pt-[env(safe-area-inset-top)] lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[392px] lg:border-l lg:border-line lg:pt-0"
    >
      <div className="flex h-[52px] flex-none items-center gap-2 border-b border-line pl-4 pr-2">
        <span className="flex-1 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">{label}</span>
        {closeHref && !onClose ? (
          <Link href={closeHref} scroll={false} aria-label="Close" className={closeButton}>
            <Icon name="close" size={24} />
          </Link>
        ) : (
          <button type="button" onClick={close} aria-label="Close" className={closeButton}>
            <Icon name="close" size={24} />
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
      {footer && (
        <div className="flex flex-none gap-2 border-t border-line bg-canvas px-4 pb-[max(34px,env(safe-area-inset-bottom))] pt-3 lg:py-3.5">
          {footer}
        </div>
      )}
    </aside>
  );
}
