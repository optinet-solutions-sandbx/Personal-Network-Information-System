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

export default function DashboardPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((data: Contact[]) => setContacts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const totalNotes = contacts.reduce(
      (sum, c) => sum + (c._count?.notes ?? 0),
      0
    );
    const companies = new Set(
      contacts.map((c) => c.company?.trim()).filter(Boolean) as string[]
    );
    const withProfile = contacts.filter((c) => c.profile).length;

    const companyCounts = new Map<string, number>();
    for (const c of contacts) {
      const co = c.company?.trim();
      if (co) companyCounts.set(co, (companyCounts.get(co) ?? 0) + 1);
    }
    const topCompanies = [...companyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const tagCounts = new Map<string, number>();
    for (const c of contacts) {
      for (const t of (c.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    return {
      totalContacts: contacts.length,
      totalNotes,
      companies: companies.size,
      withProfile,
      topCompanies,
      topTags,
    };
  }, [contacts]);

  // Already ordered by updatedAt desc from the API.
  const recent = contacts.slice(0, 6);

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500">
          An overview of your professional network.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Contacts" value={stats.totalContacts} />
        <StatCard label="Notes" value={stats.totalNotes} />
        <StatCard label="Companies" value={stats.companies} />
        <StatCard label="AI Profiles" value={stats.withProfile} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recently updated */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-semibold">Recently updated</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No contacts yet.{" "}
              <Link href="/" className="text-indigo-600 hover:underline">
                Add your first one →
              </Link>
            </p>
          ) : (
            <ul className="space-y-1">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/contacts/${c.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-zinc-50"
                  >
                    <span
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(
                        c.name ?? ""
                      )}`}
                    >
                      {(c.name?.[0] ?? "?").toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-800">
                        {c.name}
                      </span>
                      <span className="block truncate text-xs text-zinc-400">
                        {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="ml-auto flex-shrink-0 text-xs text-zinc-400">
                      {c._count?.notes ?? 0} note
                      {(c._count?.notes ?? 0) !== 1 ? "s" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top companies + tags */}
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">Top companies</h2>
            {stats.topCompanies.length === 0 ? (
              <p className="text-sm text-zinc-400">No companies yet.</p>
            ) : (
              <ul className="space-y-2">
                {stats.topCompanies.map(([company, count]) => (
                  <li
                    key={company}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="truncate text-zinc-700">{company}</span>
                    <span className="ml-3 flex-shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">Top tags</h2>
            {stats.topTags.length === 0 ? (
              <p className="text-sm text-zinc-400">No tags yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stats.topTags.map(([tag, count]) => (
                  <span
                    key={tag}
                    className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600"
                  >
                    {tag} · {count}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900">
        {value}
      </p>
    </div>
  );
}
