"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

export default function CompaniesPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No `limit` => the endpoint returns every contact, which we group locally.
    fetch("/api/contacts")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(data)) {
          throw new Error(
            (data && typeof data === "object" && data.error) ||
              "Could not load companies."
          );
        }
        return data as Contact[];
      })
      .then(setContacts)
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : "Could not load companies."
        )
      )
      .finally(() => setLoading(false));
  }, []);

  // Group contacts by company (trimmed). Contacts without a company are
  // collected separately so nothing is silently dropped from the totals.
  const { companies, noCompany } = useMemo(() => {
    const map = new Map<string, Contact[]>();
    const without: Contact[] = [];
    for (const c of contacts) {
      const co = c.company?.trim();
      if (!co) {
        without.push(c);
        continue;
      }
      const list = map.get(co);
      if (list) list.push(c);
      else map.set(co, [c]);
    }
    const sorted = [...map.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
    return { companies: sorted, noCompany: without };
  }, [contacts]);

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:text-indigo-600"
      >
        <span aria-hidden>←</span> Back to dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {loading
            ? "Your network, grouped by company."
            : `${companies.length} ${
                companies.length === 1 ? "company" : "companies"
              } across your network.`}
        </p>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
      ) : error ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-5">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-md border border-red-300 dark:border-red-900/50 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 transition-colors hover:bg-red-100 dark:hover:bg-red-900/40"
          >
            Try again
          </button>
        </div>
      ) : companies.length === 0 && noCompany.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400 dark:text-zinc-500">
          No companies yet.
        </p>
      ) : (
        <div className="space-y-4">
          {companies.map(([company, members]) => (
            <CompanyCard key={company} company={company} members={members} />
          ))}
          {noCompany.length > 0 && (
            <CompanyCard
              company="No company"
              members={noCompany}
              muted
            />
          )}
        </div>
      )}
    </div>
  );
}

function CompanyCard({
  company,
  members,
  muted,
}: {
  company: string;
  members: Contact[];
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className={`text-lg font-semibold ${
            muted ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-900 dark:text-zinc-100"
          }`}
        >
          {company}
        </h2>
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {members.length}{" "}
          {members.length === 1 ? "contact" : "contacts"}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {members.map((c) => (
          <li key={c.id}>
            <Link
              href={`/contacts/${c.id}`}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarColor(
                  c.name ?? ""
                )}`}
              >
                {(c.name?.[0] ?? "?").toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {c.name}
                </span>
                <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
                  {c.title || "—"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
