import Link from "next/link";

export default function ClientNotFound() {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Client not found</h1>
      <p className="text-sm text-muted">This client does not exist, or the link is wrong.</p>
      <Link href="/clients" className="inline-flex min-h-11 items-center text-brand underline">Back to Clients</Link>
    </section>
  );
}
