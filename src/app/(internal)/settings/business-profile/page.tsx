import { ActionForm } from "@/ui/ActionForm";
import { BTN_PRIMARY, Card, Field, INPUT, TEXTAREA } from "@/ui/forms";
import { requireOwner } from "@/platform/auth/actor";
import { getBusinessProfile } from "@/domains/admin/service";
import { saveBusinessProfileAction } from "../actions";

export const metadata = { title: "Business profile" };

export default async function BusinessProfilePage() {
  const actor = await requireOwner();
  const p = await getBusinessProfile(actor);
  return (
    <ActionForm
      action={saveBusinessProfileAction}
      submitLabel="Save changes"
      className="flex flex-col gap-3"
      buttonClassName={BTN_PRIMARY}
      note="Every change is written to the audit log."
    >
      <Card className="px-4 py-1.5">
        <Field label="Legal name"><input name="legalName" defaultValue={p.legalName} required maxLength={200} className={INPUT} /></Field>
        <Field label="Display name"><input name="displayName" defaultValue={p.displayName ?? ""} maxLength={100} className={INPUT} /></Field>
        <Field label="Contact email"><input name="contactEmail" type="email" defaultValue={p.contactEmail ?? ""} className={INPUT} /></Field>
        <Field label="Phone"><input name="phone" defaultValue={p.phone ?? ""} maxLength={40} className={INPUT} /></Field>
        <Field label="Mailing address"><textarea name="mailingAddress" defaultValue={p.mailingAddress ?? ""} maxLength={500} rows={3} className={TEXTAREA} /></Field>
        <Field label="Website"><input name="websiteUrl" type="url" defaultValue={p.websiteUrl ?? ""} placeholder="https://" className={INPUT} /></Field>
      </Card>
    </ActionForm>
  );
}
