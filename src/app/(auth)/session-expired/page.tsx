import Link from "next/link";

export const metadata = { title: "Session expired" };

export default function SessionExpiredPage() {
  return (
    <section>
      <h2>Your session expired</h2>
      <p>For your security you were signed out. Sign in again to continue.</p>
      <p>
        <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
