"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Page title. On phones it is the big heading at the top of the page; from md up the title and
 * subtitle appear in the top bar (filled into the slot the shell leaves there).
 * `phone={false}` is for pages that have their own phone header (the client workspace).
 */
export function PageTitle({ title, sub, phone = true }: { title: string; sub?: string; phone?: boolean }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("page-title-slot")), []);
  return (
    <>
      {phone && (
        <div className="pb-3.5 md:hidden">
          <h1 className="m-0 text-[30px] font-semibold leading-[1.1] tracking-[-.02em]">{title}</h1>
          {sub && <div className="mt-1 text-[14px] text-dim">{sub}</div>}
        </div>
      )}
      {slot &&
        createPortal(
          <>
            <h1 className="m-0 truncate text-[17px] font-semibold leading-[1.25]">{title}</h1>
            {sub && <div className="truncate text-[12px] leading-[1.25] text-dim">{sub}</div>}
          </>,
          slot,
        )}
    </>
  );
}
