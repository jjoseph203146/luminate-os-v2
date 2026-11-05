import type { ReactNode } from "react";
import { PageTitle } from "@/ui/shell/PageTitle";

export default function AutomationsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageTitle title="Automations" sub="Scheduled jobs and their recent runs" />
      <div className="flex flex-col gap-5">{children}</div>
    </>
  );
}
