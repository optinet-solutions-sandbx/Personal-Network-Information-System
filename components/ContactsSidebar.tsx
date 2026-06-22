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

// Bucket contacts into A–Z sections. Non-letter names fall under "#".
// Aggregates by letter (not by adjacency) so each letter is a single, unique
// section regardless of input order — avoids duplicate React keys when the list
// is briefly not fully name-sorted (e.g. during a sort-preference refetch).
function groupByInitial(contacts: Contact[]): { letter: string; items: Contact[] }[] {
  const byLetter = new Map<string, Contact[]>();
  for (const c of contacts) {
    const first = (c.name?.trim()?.[0] ?? "#").toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    const items = byLetter.get(letter);
    if (items) items.push(c);
    else byLetter.set(letter, [c]);
  }
  return [...byLetter.entries()]
    .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
    .map(([letter, items]) => ({ letter, items }));
}

const COLLAPSE_KEY = "networky:sidebar-collapsed";
// Must match the keys the contacts page (app/contacts/page.tsx) writes to, so
// the two views share one sort preference.
type SortMode = "name" | "recent";
const SORT_KEY = "networky:contacts-sort";
const SORT_EVENT = "networky:contacts-sort-change";
// Dispatched by the contacts page after a create/merge so the sidebar refetches
// even though the route hasn't changed. Must match the page's constant.
const CONTACTS_CHANGED_EVENT = "networky:contacts-changed";

export default function ContactsSidebar() {
  const pathname = usePathname();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [collapsed, setCollapsed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 50;

  // Restore the collapsed preference once on mount.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  // Follow the sort preference set on the contacts page: read it on mount, then
  // react to in-tab changes (custom event) and other-tab changes (storage).
  useEffect(() => {
    const read = () =>
      setSort(localStorage.getItem(SORT_KEY) === "recent" ? "recent" : "name");
    read();
    const onCustom = (e: Event) => {
      const next = (e as CustomEvent).detail;
      setSort(next === "recent" ? "recent" : "name");
    };
    window.addEventListener(SORT_EVENT, onCustom);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(SORT_EVENT, onCustom);
      window.removeEventListener("storage", read);
    };
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const fetchPage = useCallback(
    async (q: string, offset: number) => {
      const res = await fetch(
        `/api/contacts?q=${encodeURIComponent(q)}&sort=${sort}&limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Contact[];
      return { data, more: res.headers.get("X-Has-More") === "true" };
    },
    [sort]
  );

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

  // Refetch when a contact is created/merged on the current page — that path
  // doesn't change the route, so the navigation effect above wouldn't fire.
  useEffect(() => {
    const onChanged = () => load(query);
    window.addEventListener(CONTACTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONTACTS_CHANGED_EVENT, onChanged);
  }, [query, load]);

  const onDashboard = pathname === "/dashboard";

  // A single contact row in the expanded list (shared by the A–Z and flat views).
  const renderContactLink = (c: Contact) => {
    const active = pathname === `/contacts/${c.id}`;
    const initial = (c.name?.[0] ?? "?").toUpperCase();
    return (
      <Link
        key={c.id}
        href={`/contacts/${c.id}`}
        className={`flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors ${
          active
            ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300"
            : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
              active ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-800 dark:text-zinc-100"
            }`}
          >
            {c.name}
          </span>
          <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">
            {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
      </Link>
    );
  };

  // ── Collapsed: thin icon rail ───────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="flex w-14 flex-shrink-0 flex-col items-center border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
        >
          »
        </button>

        <Link
          href="/dashboard"
          title="Dashboard"
          className={`mt-2 flex h-8 w-8 items-center justify-center rounded-md text-base transition-colors ${
            onDashboard ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
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

        <div className="mt-2 h-px w-8 bg-zinc-100 dark:bg-zinc-800" />

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
    <aside className="flex w-56 flex-shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-1 px-2 pt-3">
        <Link
          href="/dashboard"
          className={`flex flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors ${
            onDashboard
              ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300"
              : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          «
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
        <Link
          href="/contacts"
          className={`rounded-md px-1.5 py-0.5 text-sm font-semibold transition-colors ${
            pathname === "/contacts"
              ? "text-indigo-700 dark:text-indigo-300"
              : "text-zinc-900 dark:text-zinc-100 hover:text-indigo-700 dark:hover:text-indigo-300"
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
          className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 focus:ring-0"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {sort === "name"
          ? groupByInitial(contacts).map((group) => (
              <div key={group.letter}>
                <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {group.letter}
                </p>
                {group.items.map(renderContactLink)}
              </div>
            ))
          : contacts.map(renderContactLink)}

        {contacts.length === 0 && (
          <p className="px-2 py-3 text-xs text-zinc-400 dark:text-zinc-500">
            {query ? "No matches." : "No contacts yet."}
          </p>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-1 w-full rounded-md px-2 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </nav>
    </aside>
  );
}
