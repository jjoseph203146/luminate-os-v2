import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main>
      <h1>Luminate OS</h1>
      {children}
    </main>
  );
}
