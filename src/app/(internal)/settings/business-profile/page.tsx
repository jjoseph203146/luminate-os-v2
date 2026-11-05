import { ActionForm } from "@/ui/ActionForm";
import { requireOwner } from "@/platform/auth/actor";
import { getBusinessProfile } from "@/domains/admin/service";
import { saveBusinessProfileAction } from "../actions";

export const metadata = { title: "Business profile" };

export default async function BusinessProfilePage() {
  const actor = await requireOwner();
  const p = await getBusinessProfile(actor);
  return (
    <section>
      <h1>Business profile</h1>
      <ActionForm action={saveBusinessProfileAction} submitLabel="Save">
        <p><label>Legal name <input name="legalName" defaultValue={p.legalName} required maxLength={200} /></label></p>
        <p><label>Display name <input name="displayName" defaultValue={p.displayName ?? ""} maxLength={100} /></label></p>
        <p><label>Contact email <input name="contactEmail" type="email" defaultValue={p.contactEmail ?? ""} /></label></p>
        <p><label>Phone <input name="phone" defaultValue={p.phone ?? ""} maxLength={40} /></label></p>
        <p><label>Mailing address <textarea name="mailingAddress" defaultValue={p.mailingAddress ?? ""} maxLength={500} rows={3} /></label></p>
        <p><label>Website <input name="websiteUrl" type="url" defaultValue={p.websiteUrl ?? ""} placeholder="https://" /></label></p>
      </ActionForm>
    </section>
  );
}
