// Next 16 "proxy" (formerly middleware). Runs before every page:
//  1. refreshes the Supabase session cookies,
//  2. sends visitors without a session to the sign-in page,
//  3. sets a per-request Content-Security-Policy.
// This is a coarse gate only. Every page and server action also checks the
// actor itself (platform/auth/actor.ts), so nothing relies on this file alone.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { EnvError, getPublicEnv } from "@/platform/env";
import { isPublicPath, safeNextPath } from "@/platform/auth/rules";
import { buildCsp } from "@/platform/security/csp";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The scheduler and the AI assistant connector authenticate with their own keys and need no session or CSP.
  if (pathname === "/api/jobs/tick" || pathname === "/api/mcp") return NextResponse.next();

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === "development" });

  const passThrough = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };

  let env: ReturnType<typeof getPublicEnv>;
  try {
    env = getPublicEnv();
  } catch (e) {
    const names = e instanceof EnvError ? e.names.join(", ") : "unknown";
    return new NextResponse(`Server is not configured. Missing or invalid: ${names}`, { status: 503 });
  }

  let response = passThrough();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = passThrough();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();

  const redirectTo = (path: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  };

  if (!data.user && !isPublicPath(pathname)) {
    const hadSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    if (hadSession) return redirectTo("/session-expired");
    return redirectTo("/login", { next: safeNextPath(pathname + search) });
  }
  if (data.user && pathname === "/login") return redirectTo("/");

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
