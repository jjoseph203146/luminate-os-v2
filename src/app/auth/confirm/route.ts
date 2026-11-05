import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/platform/db/server";
import { safeNextPath } from "@/platform/auth/rules";

export const dynamic = "force-dynamic";

// Landing point for the links in invitation and password-reset emails
// (the Supabase email templates must point here; see docs/architecture/10).
const ALLOWED_TYPES = ["invite", "recovery"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const next = safeNextPath(request.nextUrl.searchParams.get("next") ?? "/reset-password");

  const fail = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=link";
    return NextResponse.redirect(url);
  };

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type as AllowedType)) return fail();

  const supabase = await createUserClient();
  const { error } = await supabase.auth.verifyOtp({ type: type as AllowedType, token_hash: tokenHash });
  if (error) return fail();

  const url = request.nextUrl.clone();
  url.pathname = next.split("?")[0] ?? "/";
  url.search = next.includes("?") ? `?${next.split("?")[1]}` : "";
  return NextResponse.redirect(url);
}
