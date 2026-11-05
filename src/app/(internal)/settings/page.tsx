import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/actor";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireOwner();
  redirect("/settings/business-profile");
}
