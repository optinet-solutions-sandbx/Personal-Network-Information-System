"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ContactsSidebar from "@/components/ContactsSidebar";
import HeaderActions from "@/components/HeaderActions";
import { signout } from "@/app/auth/actions";

const authEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

// App chrome (header + sidebar). Rendered around every page except the
// full-bleed login screen.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The login page gets a clean, chrome-free layout.
  if (pathname === "/login") {
    return <main className="flex-1 overflow-y-auto">{children}</main>;
  }

  return (
    <>
      <header className="border-b border-zinc-200 bg-white">
        <div className="flex items-center justify-between px-6 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              N
            </span>
            <span className="text-lg font-semibold tracking-tight">
              Networky<span className="text-indigo-600">.ai</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <HeaderActions />
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500">
              Phase 1 · MVP
            </span>
            {authEnabled && <UserMenu />}
          </div>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <ContactsSidebar />
        <main className="flex-1 overflow-y-auto px-6 py-8">{children}</main>
      </div>
    </>
  );
}

function UserMenu() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Import lazily so the browser Supabase client is only created when auth
    // is actually configured.
    import("@/lib/supabase/client").then(({ createClient }) => {
      createClient()
        .auth.getUser()
        .then(({ data }) => {
          if (active) setEmail(data.user?.email ?? null);
        });
    });
    return () => {
      active = false;
    };
  }, []);

  if (!email) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[14rem] truncate text-xs text-zinc-500 sm:inline">
        {email}
      </span>
      <form action={signout}>
        <button
          type="submit"
          className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
