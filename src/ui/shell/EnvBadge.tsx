/**
 * STAGING / LOCAL marker, so a test copy is never mistaken for the real app. Production shows no label
 * (owner decision 2026-11-06); Settings → System still names the environment.
 */
export function EnvBadge({ env }: { env: string }) {
  if (env === "production") return null;
  return (
    <span aria-label="Environment" className="rounded-md bg-amber-soft px-[7px] py-1 font-mono text-[10px] font-semibold tracking-[.1em] text-amber">
      {env.toUpperCase()}
    </span>
  );
}
