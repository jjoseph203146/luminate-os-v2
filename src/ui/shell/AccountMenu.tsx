"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, type IconName } from "@/ui/Icon";
import { Panel } from "@/ui/Panel";
import { ThemeToggle } from "@/ui/ThemeToggle";

const rowCls = "flex min-h-[58px] w-full items-center gap-3 border-t border-line px-3.5 py-2.5 text-left first:border-t-0 hover:bg-hover";

function Tile({ icon }: { icon: IconName }) {
  return (
    <span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-chip text-dim">
      <Icon name={icon} size={18} />
    </span>
  );
}

/** Avatar button (phone top bar / sidebar footer) that opens the Account panel. */
export function AccountMenu({
  email,
  signOut,
  variant,
}: {
  email: string | null;
  signOut: () => Promise<void>;
  variant: "phone" | "side";
}) {
  const [open, setOpen] = useState(false);
  const initial = (email?.[0] ?? "O").toUpperCase();
  const name = email ? email.split("@")[0] : "Owner";
  const avatar = (size: string) => (
    <span className={`grid ${size} flex-none place-items-center rounded-full bg-hero text-[13px] font-semibold text-white`}>{initial}</span>
  );
  return (
    <>
      {variant === "phone" ? (
        <button type="button" onClick={() => setOpen(true)} aria-label="Account menu" className="grid h-11 w-11 place-items-center">
          {avatar("h-[30px] w-[30px]")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Account menu"
          className="mt-2 flex items-center gap-2.5 border-t border-line p-2 text-left"
        >
          {avatar("h-[30px] w-[30px]")}
          <span className="min-w-0 flex-1 leading-[1.2]">
            <span className="block truncate text-[13px] font-semibold">{name}</span>
            <span className="block text-[12px] text-dim">Owner</span>
          </span>
          <Icon name="settings" size={20} className="text-dim" />
        </button>
      )}
      {open && (
        <Panel label="Account" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[.1em] text-dim">Appearance</span>
            <ThemeToggle />
          </div>
          <div>
            <div className="mx-0.5 mb-2 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">More</div>
            <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
              <Link href="/settings" onClick={() => setOpen(false)} className={rowCls}>
                <Tile icon="settings" />
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">Settings</span><span className="block text-[13px] text-dim">Business profile and users</span></span>
              </Link>
              <Link href="/automations" onClick={() => setOpen(false)} className={rowCls}>
                <Tile icon="bolt" />
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">Automations</span><span className="block text-[13px] text-dim">Scheduled job status</span></span>
              </Link>
              <Link href="/mfa/enroll" onClick={() => setOpen(false)} className={rowCls}>
                <Tile icon="shield" />
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">Security</span><span className="block text-[13px] text-dim">Two-step sign-in</span></span>
              </Link>
              <form action={signOut}>
                <button type="submit" className={rowCls}>
                  <Tile icon="logout" />
                  <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">Sign out</span><span className="block truncate text-[13px] text-dim">{email ?? ""}</span></span>
                </button>
              </form>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
