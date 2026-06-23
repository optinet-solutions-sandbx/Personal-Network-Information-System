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
        className={`group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors ${
          active
            ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
            : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-indigo-500" />
        )}
        <span
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white transition-shadow ${avatarColor(
            c.name ?? ""
          )} ${active ? "ring-2 ring-indigo-400/60 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900" : ""}`}
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
          <ChevronIcon dir="right" />
        </button>

        <Link
          href="/dashboard"
          title="Dashboard"
          className={`mt-2 flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
            onDashboard
              ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <DashboardIcon />
        </Link>

        <Link
          href="/contacts"
          title="Add contact"
          className="mt-2 flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
        >
          <PlusIcon />
        </Link>

        <Link
          href="/network"
          title="Network map"
          className={`mt-2 flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
            pathname === "/network"
              ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <NetworkIcon />
        </Link>

        <Link
          href="/network-intel"
          title="Network intelligence"
          className={`mt-2 flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
            pathname === "/network-intel"
              ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <ChartIcon />
        </Link>

        <Link
          href="/import"
          title="Import / export"
          className={`mt-2 flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
            pathname === "/import"
              ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <ImportIcon />
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
          className={`group relative flex flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
            onDashboard
              ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
              : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
          }`}
        >
          {onDashboard && (
            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-indigo-500" />
          )}
          <DashboardIcon />
          Dashboard
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <ChevronIcon dir="left" />
        </button>
      </div>

      <nav className="px-2 pt-1">
        <NavLink href="/network" active={pathname === "/network"} icon={<NetworkIcon />}>
          Network map
        </NavLink>
        <NavLink href="/network-intel" active={pathname === "/network-intel"} icon={<ChartIcon />}>
          Network intel
        </NavLink>
        <NavLink href="/import" active={pathname === "/import"} icon={<ImportIcon />}>
          Import / export
        </NavLink>
      </nav>

      <div className="mt-1 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
        <Link
          href="/contacts"
          className={`group flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-semibold transition-colors ${
            pathname === "/contacts"
              ? "text-indigo-700 dark:text-indigo-300"
              : "text-zinc-900 dark:text-zinc-100 hover:text-indigo-700 dark:hover:text-indigo-300"
          }`}
        >
          Contacts
          {contacts.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {contacts.length}
              {hasMore ? "+" : ""}
            </span>
          )}
        </Link>
        <Link
          href="/contacts"
          className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <PlusIcon />
          Add
        </Link>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
            <SearchIcon />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-7 text-xs outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-800 dark:bg-zinc-800/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
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

// Expanded-sidebar nav row (Network map / intel), styled like the Dashboard link.
function NavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
          : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-indigo-500" />
      )}
      {icon}
      {children}
    </Link>
  );
}

// ── Icons (inline SVG, matching the stroke style used in HeaderActions) ─────────
function NetworkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M6.8 7.3 10.6 16M17.2 7.3 13.4 16M7 6h10" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M3 3v18h18" />
      <rect x="7" y="11" width="3" height="6" rx="0.5" />
      <rect x="13" y="7" width="3" height="10" rx="0.5" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
