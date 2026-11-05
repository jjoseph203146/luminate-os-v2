"use client";

import { Icon } from "@/ui/Icon";
import { useQuickAdd } from "@/ui/QuickAddProvider";

/** "Quick add" in the desktop top bar. */
export function QuickAddHeaderButton() {
  const open = useQuickAdd();
  return (
    <button
      type="button"
      onClick={() => open("request")}
      className="flex h-[38px] items-center gap-1.5 rounded-[10px] bg-primary pl-2.5 pr-3.5 text-[14px] font-semibold text-on-primary"
    >
      <Icon name="add" size={20} />
      Quick add
    </button>
  );
}

/** Round button bottom-right on phones. */
export function QuickAddFab() {
  const open = useQuickAdd();
  return (
    <button
      type="button"
      onClick={() => open("request")}
      aria-label="Quick add"
      className="fixed right-4 bottom-[calc(58px+max(26px,env(safe-area-inset-bottom))+16px)] z-20 grid h-14 w-14 place-items-center rounded-[18px] bg-primary text-on-primary shadow-[0_10px_28px_rgba(13,27,46,.28)] md:hidden"
    >
      <Icon name="add" size={28} />
    </button>
  );
}

/** "+ Task" link-style button used in section headers. */
export function AddTaskLink({ clientId }: { clientId?: string }) {
  const open = useQuickAdd();
  return (
    <button type="button" onClick={() => open("task", clientId)} className="ml-auto flex items-center gap-0.5 px-1 py-2 text-[13px] font-medium text-blue">
      <Icon name="add" size={18} />
      Task
    </button>
  );
}

/** "Request" tile on a client: opens Quick add with that client chosen. */
export function ClientRequestTile({ clientId, height = 64 }: { clientId: string; height?: number }) {
  const open = useQuickAdd();
  return (
    <button
      type="button"
      onClick={() => open("request", clientId)}
      className="flex flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface text-[12px] font-medium hover:border-line3"
      style={{ height }}
    >
      <span className="text-blue"><Icon name="add_comment" size={22} /></span>
      Request
    </button>
  );
}

/** Small "+ Add request" link in a section header. */
export function AddRequestLink({ clientId }: { clientId: string }) {
  const open = useQuickAdd();
  return (
    <button type="button" onClick={() => open("request", clientId)} className="ml-auto flex items-center gap-0.5 px-1 py-2 text-[13px] font-medium text-blue">
      <Icon name="add" size={18} />
      Add request
    </button>
  );
}
