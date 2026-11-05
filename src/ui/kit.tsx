import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { TaskCheck } from "./TaskCheck";

/** Colour pairs from the prototype's tones: [text, background]. */
export type KitTone = "red" | "amber" | "green" | "blue" | "gray";
const TONE: Record<KitTone, string> = {
  red: "text-red bg-red-soft",
  amber: "text-amber bg-amber-soft",
  green: "text-green bg-green-soft",
  blue: "text-blue bg-blue-soft",
  gray: "text-dim bg-chip",
};

export function Pill({ tone, children }: { tone: KitTone; children: ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[12px] font-semibold leading-none ${TONE[tone]}`}>{children}</span>;
}

/** Small uppercase heading above a group, with an optional count and a right-hand slot. */
export function SectionHead({ title, count, countTone = "text-dim", children }: { title: string; count?: ReactNode; countTone?: string; children?: ReactNode }) {
  return (
    <div className="mx-0.5 mb-2 flex items-center gap-2">
      <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">{title}</h2>
      {count !== undefined && <span className={`font-mono text-[12px] font-semibold ${countTone}`}>{count}</span>}
      {children}
    </div>
  );
}

/** The white rounded box that holds a list of rows. */
export function Group({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-[14px] border border-line bg-surface ${className}`}>{children}</div>;
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="px-4 py-[18px] text-[14px] leading-normal text-dim">{children}</div>;
}

export function IconTile({ icon, tone, size = 34, iconSize = 19 }: { icon: IconName; tone: KitTone; size?: number; iconSize?: number }) {
  return (
    <div className={`grid flex-none place-items-center rounded-[10px] ${TONE[tone]}`} style={{ width: size, height: size }}>
      <Icon name={icon} size={iconSize} />
    </div>
  );
}

export type RowProps = {
  href?: string;
  /** Round check box on the left (tasks). Pass the task id and whether it is done. */
  check?: { id: string; done: boolean; title: string };
  icon?: IconName;
  tone?: KitTone;
  title: string;
  done?: boolean;
  code?: string;
  sub?: string;
  pill?: string;
  pillTone?: KitTone;
  meta?: string;
  metaBad?: boolean;
  /** Mono meta text (used in "Waiting on others"). */
  metaMono?: boolean;
  minH?: string;
};

/**
 * One row of a list, as in the prototype: 34px icon tile (or round check), two-line text, and a
 * right column with a pill and a small meta line. On phones the client name sits above the
 * mono request number; on wider screens they sit side by side.
 */
export function ListRow({ href, check, icon = "circle", tone = "gray", title, done, code, sub, pill, pillTone = "gray", meta, metaBad, metaMono, minH = "min-h-[62px]" }: RowProps) {
  const body = (
    <>
      {!check && <IconTile icon={icon} tone={tone} />}
      <div className="min-w-0 flex-1">
        <div
          className={`overflow-hidden text-[15px] font-medium leading-[1.3] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere] ${done ? "text-dim line-through" : "text-ink"}`}
          style={{ maxHeight: "2.6em" }}
        >
          {title}
        </div>
        {(code || sub) && (
          <div className="mt-0.5 flex min-w-0 flex-col-reverse gap-px text-[13px] leading-[1.35] text-dim md:flex-row md:gap-1.5">
            {code && <span className="min-w-[4em] max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] md:max-w-[9.5em] md:flex-none">{code}</span>}
            {sub && <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{sub}</span>}
          </div>
        )}
      </div>
      {(pill || meta) && (
        <div className="flex flex-none flex-col items-end gap-1">
          {pill && <Pill tone={pillTone}>{pill}</Pill>}
          {meta && <span className={`whitespace-nowrap text-[12px] ${metaBad ? "text-red" : "text-dim"} ${metaMono ? "font-mono" : ""}`}>{meta}</span>}
        </div>
      )}
    </>
  );
  const inner = "flex min-w-0 flex-1 items-center gap-3 self-stretch py-2.5";
  return (
    <div className={`flex ${minH} items-center gap-3 border-t border-line px-3.5 first:border-t-0 hover:bg-hover`}>
      {check && <TaskCheck id={check.id} done={check.done} title={check.title} />}
      {href ? (
        <Link href={href} scroll={false} className={inner}>
          {body}
        </Link>
      ) : (
        <div className={inner}>{body}</div>
      )}
    </div>
  );
}

/** Pulsing placeholder used while a list loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`lx-pulse bg-skel ${className}`} />;
}

/** Square dark tile with a business's initials. */
export function Initials({ name, size, radius, text }: { name: string; size: number; radius: number; text: number }) {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const letters = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  return (
    <span
      className="grid flex-none place-items-center bg-hero font-semibold text-white"
      style={{ width: size, height: size, borderRadius: radius, fontSize: text }}
    >
      {letters}
    </span>
  );
}

/** Square action button (Call / Email / Website ...). */
export function ActionTile({ href, icon, label, height = 64, external }: { href?: string; icon: IconName; label: string; height?: number; external?: boolean }) {
  const cls = "flex flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface text-[12px] font-medium hover:border-line3";
  const inner = (
    <>
      <span className="text-blue"><Icon name={icon} size={22} /></span>
      {label}
    </>
  );
  if (!href) {
    return (
      <span aria-disabled="true" className={`${cls} opacity-50`} style={{ height }}>
        {inner}
      </span>
    );
  }
  return (
    <a href={href} className={cls} style={{ height }} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {inner}
    </a>
  );
}
