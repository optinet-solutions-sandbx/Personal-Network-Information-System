"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Contact } from "@/lib/types";

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

// Bucket an already-name-sorted list into A–Z sections. Non-letter names fall
// under "#". Relies on the API returning contacts in name order (sort=name).
function groupByInitial(contacts: Contact[]): { letter: string; items: Contact[] }[] {
  const groups: { letter: string; items: Contact[] }[] = [];
  for (const c of contacts) {
    const first = (c.name?.trim()?.[0] ?? "#").toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.items.push(c);
    else groups.push({ letter, items: [c] });
  }
  return groups;
}

const COLLAPSE_KEY = "networky:sidebar-collapsed";

export default function ContactsSidebar() {
  const pathname = usePathname();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 50;

  // Restore the collapsed preference once on mount.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const fetchPage = useCallback(async (q: string, offset: number) => {
    const res = await fetch(
      `/api/contacts?q=${encodeURIComponent(q)}&sort=name&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Contact[];
    return { data, more: res.headers.get("X-Has-More") === "true" };
  }, []);

  const load = useCallback(
    async (q: string) => {
      try {
        const { data, more } = await fetchPage(q, 0);
        setContacts(data);
        setHasMore(more);
      } catch {
        setContacts([]);
        setHasMore(false);
      }
    },
    [fetchPage]
  );

  async function loadMore() {
    setLoadingMore(true);
    try {
      const { data, more } = await fetchPage(query, contacts.length);
      setContacts((prev) => [...prev, ...data]);
      setHasMore(more);
    } catch {
      // leave the list as-is on failure
    } finally {
      setLoadingMore(false);
    }
  }

  // Reload on navigation (a save/delete elsewhere should reflect here) and on
  // search, debounced. Search runs server-side so it covers all contacts.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(query), 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, pathname, load]);

  const onDashboard = pathname === "/dashboard";

  // ── Collapsed: thin icon rail ───────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="flex w-14 flex-shrink-0 flex-col items-center border-r border-zinc-200 bg-white py-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"
        >
          »
        </button>

        <Link
          href="/dashboard"
          title="Dashboard"
          className={`mt-2 flex h-8 w-8 items-center justify-center rounded-md text-base transition-colors ${
            onDashboard ? "bg-indigo-50" : "hover:bg-zinc-50"
          }`}
        >
          📊
        </Link>

        <Link
          href="/contacts"
          title="Add contact"
          className="mt-2 flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          +
        </Link>

        <div className="mt-2 h-px w-8 bg-zinc-100" />

        <nav className="mt-2 flex flex-1 flex-col items-center gap-1.5 overflow-y-auto">
          {contacts.map((c) => {
            const active = pathname === `/contacts/${c.id}`;
            return (
              <Link
                key={c.id}
                href={`/contacts/${c.id}`}
                title={
                  [c.name, [c.title, c.company].filter(Boolean).join(" · ")]
                    .filter(Boolean)
                    .join(" — ") || c.name
                }
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarColor(
                  c.name ?? ""
                )} ${active ? "ring-2 ring-indigo-400 ring-offset-1" : ""}`}
              >
                {(c.name?.[0] ?? "?").toUpperCase()}
              </Link>
            );
          })}
        </nav>
      </aside>
    );
  }

  // ── Expanded: full sidebar ──────────────────────────────────────────────────
  return (
    <aside className="flex w-56 flex-shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex items-center gap-1 px-2 pt-3">
        <Link
          href="/dashboard"
          className={`flex flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors ${
            onDashboard
              ? "bg-indigo-50 text-indigo-700"
              : "text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          <span className="text-base leading-none">📊</span>
          Dashboard
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          «
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-zinc-100 px-4 py-3">
        <Link
          href="/contacts"
          className={`rounded-md px-1.5 py-0.5 text-sm font-semibold transition-colors ${
            pathname === "/contacts"
              ? "text-indigo-700"
              : "text-zinc-900 hover:text-indigo-700"
          }`}
        >
          Contacts
        </Link>
        <Link
          href="/contacts"
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
        {groupByInitial(contacts).map((group) => (
          <div key={group.letter}>
            <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              {group.letter}
            </p>
            {group.items.map((c) => {
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
          </div>
        ))}

        {contacts.length === 0 && (
          <p className="px-2 py-3 text-xs text-zinc-400">
            {query ? "No matches." : "No contacts yet."}
          </p>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-1 w-full rounded-md px-2 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </nav>
    </aside>
  );
}
