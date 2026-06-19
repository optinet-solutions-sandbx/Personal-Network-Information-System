"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Contact } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-red-400",
  "bg-sky-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-teal-500",
];

function avatarColor(name: string): string {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

export default function ContactsSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  const isAuthPage = pathname === "/login" || pathname === "/signup";

  useEffect(() => {
    if (isAuthPage) return;
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((data: Contact[]) => setContacts(data))
      .catch(() => {});
  }, [pathname, isAuthPage]);

  if (isAuthPage) return null;

  const filtered = query.trim()
    ? contacts.filter((c) =>
        [c.name, c.company, c.title, c.tags]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())
      )
    : contacts;

  async function handleSignout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex w-56 flex-shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold text-zinc-900">Contacts</span>
        <Link
          href="/"
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          + Add
        </Link>
      </div>

      <div className="px-3 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 focus:ring-0"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.map((c) => {
          const active = pathname === `/contacts/${c.id}`;
          const initial = (c.name?.[0] ?? "?").toUpperCase();
          return (
            <Link
              key={c.id}
              href={`/contacts/${c.id}`}
              className={`flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(
                  c.name ?? ""
                )}`}
              >
                {initial}
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-xs font-medium ${
                    active ? "text-indigo-700" : "text-zinc-800"
                  }`}
                >
                  {c.name}
                </span>
                <span className="block truncate text-[10px] text-zinc-400">
                  {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
            </Link>
          );
        })}

        {filtered.length === 0 && (
          <p className="px-2 py-3 text-xs text-zinc-400">
            {query ? "No matches." : "No contacts yet."}
          </p>
        )}
      </nav>

      <div className="border-t border-zinc-200 px-3 py-3">
        <button
          onClick={handleSignout}
          className="w-full rounded-md px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
