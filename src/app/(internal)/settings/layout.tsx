import type { ReactNode } from "react";
import { PageTitle } from "@/ui/shell/PageTitle";
import { SettingsTabs } from "./SettingsTabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageTitle title="Settings" sub="Business, catalog, calendar, users and audit log" />
      <div className="flex flex-col gap-4">
        <SettingsTabs />
        {children}
      </div>
    </>
  );
}
