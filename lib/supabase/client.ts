import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client (singleton-ish; createBrowserClient memoizes).
// Used by client components for sign-in/sign-up/sign-out.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
