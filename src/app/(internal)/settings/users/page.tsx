import { ActionForm } from "@/ui/ActionForm";
import { BTN_PRIMARY, BTN_SMALL, Card, Heading, INPUT } from "@/ui/forms";
import { Pill } from "@/ui/kit";
import { requireOwner } from "@/platform/auth/actor";
import { listUsers } from "@/domains/admin/service";
import { disableUserAction, enableUserAction, inviteOwnerAction } from "../actions";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const actor = await requireOwner();
  const users = await listUsers(actor);
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        {users.map((u) => (
          <div key={u.id} className="flex min-h-[64px] items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-hero text-[14px] font-semibold text-white">
              {(u.email?.[0] ?? "?").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">
                {u.email}
                {u.isSelf ? " (you)" : ""}
              </div>
              <div className="mt-0.5 truncate text-[13px] text-dim">Last sign-in · {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never"}</div>
            </div>
            <Pill tone={u.role === "admin" ? "blue" : "gray"}>{u.role === "admin" ? "Owner" : (u.role ?? "No access")}</Pill>
            {!u.active && <Pill tone="red">Disabled</Pill>}
            {!u.isSelf && (
              <ActionForm action={u.active ? disableUserAction : enableUserAction} submitLabel={u.active ? "Disable" : "Enable"} buttonClassName={BTN_SMALL}>
                <input type="hidden" name="userId" value={u.id} />
              </ActionForm>
            )}
          </div>
        ))}
      </Card>

      <div>
        <Heading>Invite an owner</Heading>
        <ActionForm
          action={inviteOwnerAction}
          submitLabel="Send invitation"
          className="flex flex-col gap-3"
          buttonClassName={BTN_PRIMARY}
          note="Public sign-up is off. In this phase only owners can be invited; staff, read-only and client access arrive later."
        >
          <Card className="px-4 py-3">
            <input name="email" type="email" required placeholder="name@company.com" aria-label="Email" className={INPUT} />
          </Card>
        </ActionForm>
      </div>
    </div>
  );
}
