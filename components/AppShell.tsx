"use client";

import { useEffect, useRef, useState } from "react";
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

  // The login and invite-landing pages get a clean, chrome-free layout.
  if (pathname === "/login" || pathname.startsWith("/join/")) {
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
              Phase 3 · Network
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
  const [avatar, setAvatar] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    // Pull the self-profile for the avatar + display name shown in the header.
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile: { avatar: string | null; name: string | null } | null } | null) => {
        if (active && data?.profile) {
          setAvatar(data.profile.avatar);
          setName(data.profile.name);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!email) return null;

  const initial = (name?.trim()?.[0] ?? email[0])?.toUpperCase() ?? "?";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={email}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-indigo-600 text-sm font-semibold text-white transition-shadow hover:bg-indigo-700 ${
          open ? "ring-2 ring-indigo-400/60 ring-offset-1 ring-offset-white" : ""
        }`}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
        >
          <div className="border-b border-zinc-100 px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
              Signed in as
            </p>
            <p className="truncate text-sm font-medium text-zinc-800">
              {email}
            </p>
          </div>
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <UserIcon />
            Your profile
          </Link>
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <GearIcon />
            Account settings
          </Link>
          <form action={signout}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-zinc-400">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-zinc-400">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-zinc-400">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
