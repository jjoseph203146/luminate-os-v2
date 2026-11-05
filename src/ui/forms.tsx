import type { ReactNode } from "react";

/** Styles shared by the Settings and Automations screens (prototype: 42px fields, radius 10, card radius 14). */
export const INPUT =
  "h-[42px] w-full rounded-[10px] border border-line2 bg-field px-3 text-[16px] text-ink outline-none placeholder:text-dim focus:border-blue focus:shadow-[0_0_0_3px_var(--blue-soft)]";
export const MONO_INPUT = `${INPUT} font-mono`;
export const TEXTAREA =
  "min-h-[88px] w-full rounded-[10px] border border-line2 bg-field px-3 py-2.5 text-[16px] leading-[1.45] text-ink outline-none placeholder:text-dim focus:border-blue focus:shadow-[0_0_0_3px_var(--blue-soft)]";
export const BTN_PRIMARY = "h-11 flex-none rounded-xl bg-primary px-[18px] text-[15px] font-semibold text-on-primary disabled:opacity-60";
export const BTN_SMALL = "h-9 flex-none rounded-[10px] border border-line2 bg-surface px-3 text-[13px] font-medium text-ink hover:bg-hover disabled:opacity-60";
export const BTN_TEXT = "h-9 flex-none rounded-[10px] px-2.5 text-[13px] font-medium text-blue hover:bg-hover disabled:opacity-60";
export const BTN_TEXT_RED = "h-9 flex-none rounded-[10px] px-2.5 text-[13px] font-medium text-red hover:bg-hover disabled:opacity-60";

/** The white rounded box. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-line bg-surface ${className}`}>{children}</div>;
}

/** Small uppercase heading with an optional right-hand slot. */
export function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-0.5 mb-2 flex items-center gap-2">
      <h2 className="m-0 flex-1 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">{children}</h2>
      {action}
    </div>
  );
}

/** Label on the left, control on the right (stacked on phones). Rows are separated by a hairline. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid items-center gap-x-4 gap-y-1 border-t border-line py-2.5 first:border-t-0 md:grid-cols-[180px_1fr]">
      <span className="text-[13px] text-dim">{label}</span>
      <span className="flex min-w-0 flex-col gap-1">
        {children}
        {hint && <span className="text-[12px] leading-[1.4] text-dim">{hint}</span>}
      </span>
    </label>
  );
}

/** A stacked label above a control, for small grids. */
export function Stack({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] text-dim">{label}</span>
      {children}
    </label>
  );
}

/** A real checkbox drawn as the prototype's on/off switch. No script needed. */
export function Switch({ name, value, defaultChecked, label }: { name: string; value?: string; defaultChecked?: boolean; label: string }) {
  return (
    <span className="relative inline-flex flex-none">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} aria-label={label} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" />
      <span className="block h-[31px] w-[51px] rounded-full bg-line2 transition-colors peer-checked:bg-green peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-blue" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform peer-checked:translate-x-5" />
    </span>
  );
}

/** A row with a title, a note and a switch on the right. */
export function SwitchRow({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[54px] items-center gap-3 border-t border-line px-3.5 py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{title}</div>
        {note && <div className="mt-0.5 text-[13px] text-dim">{note}</div>}
      </div>
      {children}
    </div>
  );
}

/** Plain checkbox with a text label. */
export function Check({ name, defaultChecked, children }: { name: string; defaultChecked?: boolean; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2.5 text-[14px]">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-[18px] w-[18px] flex-none accent-primary" />
      {children}
    </label>
  );
}

/** Banner above a screen. */
export function Banner({ tone = "blue", icon, children }: { tone?: "blue" | "amber"; icon: ReactNode; children: ReactNode }) {
  const cls = tone === "amber" ? "bg-amber-soft text-amber" : "bg-blue-soft text-blue";
  return (
    <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-[1.45] ${cls}`}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
