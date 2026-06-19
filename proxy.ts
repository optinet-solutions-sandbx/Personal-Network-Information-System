import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolveOrCreateWorkspace } from "@/lib/workspace";

export async function proxy(request: NextRequest) {
  // Build a mutable response so Supabase can refresh session cookies
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const name = (user.user_metadata?.name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined);

  const { workspaceId } = await resolveOrCreateWorkspace(
    user.id,
    user.email!,
    name
  );

  // Forward user context to route handlers via request headers,
  // while preserving any session cookies Supabase refreshed above.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", user.id);
  requestHeaders.set("x-workspace-id", workspaceId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Copy any cookie refreshes from Supabase to the final response
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie.name, cookie.value, cookie);
  });

  return response;
}

export const config = {
  matcher: [
    // Run proxy on all routes except: login, signup, Next.js internals, static files
    "/((?!login|signup|_next/static|_next/image|favicon|apple-icon|icon).*)",
  ],
};
