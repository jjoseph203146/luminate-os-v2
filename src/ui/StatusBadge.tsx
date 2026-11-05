export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

const tones: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  info: "bg-info-bg text-info",
  neutral: "bg-neutral-bg text-muted",
};

/** Colour is never the only signal: the label always says what it means. */
export function StatusBadge({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
