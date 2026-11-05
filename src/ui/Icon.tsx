import { ICON_PATHS, type IconName } from "./icons.generated";

/**
 * Inline Material Symbols (Rounded). The same glyphs as the design prototype, drawn as SVG
 * so no icon font has to load (the app's security policy only allows its own fonts).
 */
export function Icon({
  name,
  size = 20,
  filled = false,
  className,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
  className?: string;
}) {
  const p = ICON_PATHS[name];
  if (!p) return null;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      className={className}
      style={{ flex: "none", display: "block" }}
    >
      <path d={filled && p.f ? p.f : p.o} />
    </svg>
  );
}
export type { IconName };
