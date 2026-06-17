"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Swal from "sweetalert2";
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

const COLLAPSE_KEY = "networky:sidebar-collapsed";

export default function ContactsSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);

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

  async function handleDelete(e: React.MouseEvent, contact: Contact) {
    e.preventDefault();
    e.stopPropagation();
    const result = await Swal.fire({
      title: "Delete Contact?",
      html: `<p style="font-size:0.875rem;color:#6b7280">Are you sure you want to delete <strong>${contact.name}</strong>? This cannot be undone.</p>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      reverseButtons: true,
    });
    if (!result.isConfirmed) return;
    await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
    setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    if (pathname === `/contacts/${contact.id}`) router.push("/");
  }

  async function handleDelete(e: React.MouseEvent, contact: Contact) {
    e.preventDefault();
    e.stopPropagation();
    const result = await Swal.fire({
      title: "Delete Contact?",
      html: `<p style="font-size:0.875rem;color:#6b7280">Are you sure you want to delete <strong>${contact.name}</strong>? This cannot be undone.</p>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      reverseButtons: true,
    });
    if (!result.isConfirmed) return;
    await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
    setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    if (pathname === `/contacts/${contact.id}`) router.push("/");
  }

  useEffect(() => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((data: Contact[]) => setContacts(data))
      .catch(() => {});
  }, [pathname]);

  const filtered = query.trim()
    ? contacts.filter((c) =>
        [c.name, c.company, c.title, c.tags]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())
      )
    : contacts;

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
          href="/"
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
            <div key={c.id} className="group relative">
              <Link
                href={`/contacts/${c.id}`}
                className={`flex items-center gap-2.5 rounded-md px-2 py-2 pr-7 transition-colors ${
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
              <button
                onClick={(e) => handleDelete(e, c)}
                title="Delete contact"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="px-2 py-3 text-xs text-zinc-400">
            {query ? "No matches." : "No contacts yet."}
          </p>
        )}
      </nav>
    </aside>
  );
}
