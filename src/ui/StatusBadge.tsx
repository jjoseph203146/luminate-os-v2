export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

const tones: Record<Tone, string> = {
  ok: "bg-green-soft text-green",
  warn: "bg-amber-soft text-amber",
  bad: "bg-red-soft text-red",
  info: "bg-blue-soft text-blue",
  neutral: "bg-chip text-dim",
};

/** Colour is never the only signal: the label always says what it means. */
export function StatusBadge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-1 text-[12px] font-semibold leading-none ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Small outlined flag, e.g. "On hold" / "Archived". */
export function Flag({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-line2 px-[7px] py-[3px] text-[11px] font-medium leading-none text-dim">
      {children}
    </span>
  );
}
