import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="plain mx-auto w-full max-w-md px-4 py-8">
      <h1>Luminate OS</h1>
      {children}
    </main>
  );
}
