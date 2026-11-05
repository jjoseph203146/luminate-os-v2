import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
        <img src="/logo.png" alt="" width={40} height={40} className="h-10 w-10 rounded-xl object-cover" />
        <div className="text-[20px] font-semibold tracking-[-.01em]">Luminate OS</div>
      </div>
      <div className="auth lx-up w-full max-w-[400px] rounded-[20px] border border-line bg-surface px-6 py-7 shadow-[0_1px_2px_rgba(13,27,46,.04),0_12px_32px_rgba(13,27,46,.06)]">
        {children}
      </div>
    </main>
  );
}
