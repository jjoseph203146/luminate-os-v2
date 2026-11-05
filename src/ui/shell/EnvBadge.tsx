/** STAGING / PRODUCTION marker. Production is red so it is never mistaken for staging. */
export function EnvBadge({ env }: { env: string }) {
  const prod = env === "production";
  return (
    <span
      aria-label="Environment"
      className={`rounded-md px-[7px] py-1 font-mono text-[10px] font-semibold tracking-[.1em] ${prod ? "bg-red-soft text-red" : "bg-amber-soft text-amber"}`}
    >
      {env.toUpperCase()}
    </span>
  );
}
