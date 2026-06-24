"use client";

// Shared list view for the dedicated subset routes (/notes, /birthdays). Each
// is just a focused, read-only contacts list backed by the same
// `/api/contacts?filter=` endpoint the Network-intel metric cards point at.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/types";
import { formatBirthday } from "@/lib/birthdays";

// Deterministic avatar tint per contact — matches the palette used on the
// contacts list and sidebar so the same person reads the same color everywhere.
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

const PAGE_SIZE = 50;

export default function ContactSubsetView({
  variant,
  title,
  subtitle,
  emptyText,
}: {
  variant: "notes" | "birthday";
  title: string;
  subtitle: string;
  emptyText: string;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (offset: number) => {
      const res = await fetch(
        `/api/contacts?filter=${variant}&sort=name&limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Contact[];
      const more = res.headers.get("X-Has-More") === "true";
      return { data, more };
    },
    [variant]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    fetchPage(0)
      .then(({ data, more }) => {
        if (!active) return;
        setContacts(data);
        setHasMore(more);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [fetchPage]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const { data, more } = await fetchPage(contacts.length);
      setContacts((prev) => [...prev, ...data]);
      setHasMore(more);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/network-intel"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-indigo-600"
      >
        <span aria-hidden>←</span> Network intel
      </Link>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-zinc-500">{subtitle}</p>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>
      ) : error && contacts.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 p-8 text-center text-sm text-red-600">
          Couldn&apos;t load contacts — check your connection.
        </p>
      ) : contacts.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 p-8 text-center text-sm text-zinc-400">
          {emptyText}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/80">
                  <Th>Name</Th>
                  <Th>Company</Th>
                  <Th>{variant === "birthday" ? "Birthday" : "Notes"}</Th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr
                    key={c.id}
                    className="group/row border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/contacts/${c.id}`} className="group flex items-center gap-3">
                        <span
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ring-1 ring-black/5 transition-all group-hover/row:ring-2 group-hover/row:ring-indigo-400/60 group-hover/row:shadow-[0_0_16px_-2px_rgba(99,102,241,0.75)] ${avatarColor(
                            c.name ?? ""
                          )}`}
                        >
                          {(c.name?.[0] ?? "?").toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-zinc-900 group-hover:text-indigo-700 group-hover:underline">
                            {c.name}
                          </span>
                          {c.title && (
                            <span className="block truncate text-xs text-zinc-400">
                              {c.title}
                            </span>
                          )}
                        </span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-700">
                      {c.company || <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {variant === "birthday" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-600 ring-1 ring-indigo-500/30">
                          <span aria-hidden>🎂</span>
                          {formatBirthday(c.birthday) || "—"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-600 ring-1 ring-indigo-500/30">
                          <span aria-hidden>📝</span>
                          {c._count?.notes ?? 0} note{(c._count?.notes ?? 0) === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
    >
      {children}
    </th>
  );
}
