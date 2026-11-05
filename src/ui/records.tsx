import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Label/value rows in a white card, as in the prototype's record panels. */
export function KvCard({ children }: { children: ReactNode }) {
  return <div className="rounded-[14px] border border-line bg-surface px-3.5 py-0.5">{children}</div>;
}

export function Kv({ label, children, href, mono }: { label: string; children: ReactNode; href?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3.5 border-b border-line py-2.5 text-[14px]">
      <span className="flex-none text-dim">{label}</span>
      {href ? (
        <Link href={href} className="flex items-center gap-0.5 text-right text-[14px] font-medium text-blue">
          {children}
          <Icon name="chevron_right" size={18} />
        </Link>
      ) : (
        <span className={`min-w-0 text-right [overflow-wrap:anywhere] ${mono ? "font-mono text-[12px]" : ""}`}>{children}</span>
      )}
    </div>
  );
}

export function PanelLabel({ children }: { children: ReactNode }) {
  return <div className="mx-0.5 mb-2 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">{children}</div>;
}

export function TextCard({ children }: { children: ReactNode }) {
  return <div className="whitespace-pre-line rounded-[14px] border border-line bg-surface px-3.5 py-3 text-[14px] leading-[1.55]">{children}</div>;
}

/** Horizontally scrolling filter chips; Link-based so the filter lives in the address. */
export function ChipLink({ href, on, children, count }: { href: string; on: boolean; children: ReactNode; count?: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={on ? "page" : undefined}
      className={`flex h-9 flex-none items-center gap-1.5 rounded-full border px-3 text-[14px] font-medium ${on ? "border-primary bg-primary text-on-primary" : "border-line2 bg-surface text-ink"}`}
    >
      {children}
      {count !== undefined && <span className="font-mono text-[12px] opacity-70">{count}</span>}
    </Link>
  );
}
