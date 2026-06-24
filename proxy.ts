import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Next.js 16 renamed `middleware` → `proxy`. This runs on every matched route
// to (a) refresh the Supabase auth session cookie and (b) redirect
// unauthenticated users to /login. When the Supabase env vars are not set the
// app runs in open mode and this is a no-op.
export default async function proxy(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next();

  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: getUser() refreshes the session; don't run logic between this
  // and the response, per Supabase SSR guidance.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api");
  const isPublic = path === "/login" || path.startsWith("/auth");

  // API routes enforce auth themselves (returning 401), so don't redirect them.
  if (!user && !isApi && !isPublic) {
    // Preserve where they were headed (e.g. an /join/<token> invite link) so
    // login can send them back there afterwards.
    const login = new URL("/login", req.url);
    login.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  // Signed-in users shouldn't see the login page.
  if (user && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return res;
}

export const config = {
  // Run on everything except static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|ico|svg|jpg|jpeg|webp)$).*)"],
};
