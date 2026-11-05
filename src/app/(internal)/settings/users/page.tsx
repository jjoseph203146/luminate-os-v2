import { ActionForm } from "@/ui/ActionForm";
import { requireOwner } from "@/platform/auth/actor";
import { listUsers } from "@/domains/admin/service";
import { disableUserAction, enableUserAction, inviteOwnerAction } from "../actions";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const actor = await requireOwner();
  const users = await listUsers(actor);
  return (
    <section>
      <h1>Users</h1>
      <p>Public sign-up is off. Accounts are created by invitation only. In this phase only owners can be invited; contractor and client access arrive later.</p>
      <table>
        <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}{u.isSelf ? " (you)" : ""}</td>
              <td>{u.role === "admin" ? "Owner" : (u.role ?? "No access")}</td>
              <td>{u.active ? "Active" : "Disabled"}</td>
              <td>{u.lastSignInAt ?? "Never"}</td>
              <td>
                {!u.isSelf && (
                  <ActionForm action={u.active ? disableUserAction : enableUserAction} submitLabel={u.active ? "Disable" : "Enable"}>
                    <input type="hidden" name="userId" value={u.id} />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Invite an owner</h2>
      <ActionForm action={inviteOwnerAction} submitLabel="Send invitation">
        <p><label>Email <input name="email" type="email" required /></label></p>
      </ActionForm>
    </section>
  );
}
