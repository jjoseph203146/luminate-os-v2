"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

type Theme = "light" | "dark";

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light / Dark switch. Until the owner picks, the phone's own setting is used. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(readTheme()), []);

  const choose = (next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("lx-theme", next);
    } catch {
      /* storage blocked: the choice lasts until the page closes */
    }
    setTheme(next);
  };

  const opts: [Theme, string, "light_mode" | "dark_mode"][] = [
    ["light", "Light", "light_mode"],
    ["dark", "Dark", "dark_mode"],
  ];
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-2 gap-0.5 rounded-[11px] bg-chip p-[3px]">
      {opts.map(([value, label, icon]) => {
        const on = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(value)}
            className={`flex h-10 items-center justify-center gap-1.5 rounded-[9px] text-[14px] font-medium ${on ? "bg-surface text-ink shadow-[0_1px_3px_rgba(13,27,46,.16)]" : "text-dim"}`}
          >
            <Icon name={icon} size={18} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
