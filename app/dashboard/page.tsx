"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/types";
import { computeUpcomingBirthdays } from "@/lib/birthdays";
import InsightsFeed from "@/components/InsightsFeed"
import SuggestedIntroductions from "@/components/SuggestedIntroductions";
import SentMessages from "@/components/SentMessages";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/contacts")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        // On failure the API returns an { error } object, not an array — guard
        // against it so the dashboard shows a message instead of crashing.
        if (!r.ok || !Array.isArray(data)) {
          throw new Error(
            (data && typeof data === "object" && data.error) ||
              "Could not load contacts."
          );
        }
        return data as Contact[];
      })
      .then((data) => setContacts(data))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load contacts.")
      )
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

  const birthdays = useMemo(
    () => computeUpcomingBirthdays(contacts, 60), // how far out "upcoming" looks
    [contacts]
  );

  // Already ordered by updatedAt desc from the API.
  const recent = contacts.slice(0, 6);

  if (loading) return <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-5">
        <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">
          Couldn’t load your dashboard
        </h2>
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 rounded-md border border-red-300 dark:border-red-900/50 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 transition-colors hover:bg-red-100 dark:hover:bg-red-900/40"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          An overview of your professional network.
        </p>
      </div>

      <div className="mb-6">
        <InsightsFeed />
      </div>

      <div className="mb-6">
        <SuggestedIntroductions />
      </div>

      <div className="mb-6">
        <SentMessages />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Contacts" value={stats.totalContacts} href="/" accent="cyan" />
        <StatCard label="Notes" value={stats.totalNotes} href="/notes" accent="violet" />
        <StatCard label="Companies" value={stats.companies} href="/companies" accent="emerald" />
        <StatCard label="AI Profiles" value={stats.withProfile} href="/profiles" accent="fuchsia" />
      </div>

      {/* Birthdays */}
      <div className="mt-6 rounded-xl border border-amber-400/30 bg-white dark:bg-zinc-900/60 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent p-5 backdrop-blur-sm shadow-[0_0_24px_-8px_rgba(251,191,36,0.35)]">
        <h2 className="mb-3 text-lg font-semibold text-amber-700 dark:text-amber-300">🎂 Birthdays</h2>
        {birthdays.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No upcoming birthdays in the next 60 days. Add a “Birthday” detail to
            a contact to see them here.
          </p>
        ) : (
          <ul className="space-y-1">
            {birthdays.map((b) => (
              <li key={b.contact.id}>
                <Link
                  href={`/contacts/${b.contact.id}`}
                  className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <span
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(
                      b.contact.name ?? ""
                    )}`}
                  >
                    {(b.contact.name?.[0] ?? "?").toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {b.contact.name}
                      {b.turningAge != null && (
                        <span className="ml-2 text-xs font-normal text-zinc-400 dark:text-zinc-500">
                          turns {b.turningAge}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
                      {b.next.toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                  </span>
                  <span className="ml-auto flex-shrink-0">
                    <BirthdayBadge daysUntil={b.daysUntil} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recently updated */}
        <div className="rounded-xl border border-cyan-400/30 bg-white dark:bg-zinc-900/60 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent p-5 backdrop-blur-sm shadow-[0_0_24px_-8px_rgba(34,211,238,0.35)]">
          <h2 className="mb-3 text-lg font-semibold text-cyan-700 dark:text-cyan-300">Recently updated</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No contacts yet.{" "}
              <Link href="/contacts" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                Add your first one →
              </Link>
            </p>
          ) : (
            <ul className="space-y-1">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/contacts/${c.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <span
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(
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
                        {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="ml-auto flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
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
          <div className="rounded-xl border border-emerald-400/30 bg-white dark:bg-zinc-900/60 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent p-5 backdrop-blur-sm shadow-[0_0_24px_-8px_rgba(52,211,153,0.35)]">
            <h2 className="mb-3 text-lg font-semibold text-emerald-700 dark:text-emerald-300">Top companies</h2>
            {stats.topCompanies.length === 0 ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">No companies yet.</p>
            ) : (
              <ul className="space-y-1">
                {stats.topCompanies.map(([company, count]) => (
                  <li key={company}>
                    <Link
                      href={`/contacts?q=${encodeURIComponent(company)}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <span className="truncate text-zinc-700 dark:text-zinc-200">{company}</span>
                      <span className="ml-3 flex-shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-fuchsia-400/30 bg-white dark:bg-zinc-900/60 bg-gradient-to-br from-fuchsia-500/10 via-transparent to-transparent p-5 backdrop-blur-sm shadow-[0_0_24px_-8px_rgba(232,121,249,0.35)]">
            <h2 className="mb-3 text-lg font-semibold text-fuchsia-700 dark:text-fuchsia-300">Top tags</h2>
            {stats.topTags.length === 0 ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">No tags yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stats.topTags.map(([tag, count]) => (
                  <Link
                    key={tag}
                    href={`/contacts?q=${encodeURIComponent(tag)}`}
                    className="rounded-full bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                  >
                    {tag} · {count}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BirthdayBadge({ daysUntil }: { daysUntil: number }) {
  let text: string;
  let className: string;

  if (daysUntil === 0) {
    text = "Today 🎉";
    className = "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300";
  } else if (daysUntil === 1) {
    text = "Tomorrow";
    className = "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";
  } else if (daysUntil <= 7) {
    text = `in ${daysUntil} days`;
    className = "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300";
  } else {
    text = `in ${daysUntil} days`;
    className = "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400";
  }

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {text}
    </span>
  );
}

type Accent = "cyan" | "violet" | "emerald" | "fuchsia";

// Each card gets its own neon accent: a tinted gradient surface, a glowing
// border, and a value that lights up on hover for a futuristic feel.
const ACCENTS: Record<
  Accent,
  { card: string; label: string; value: string; glow: string }
> = {
  cyan: {
    card: "border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent hover:border-cyan-400/60 hover:shadow-[0_0_24px_-4px_rgba(34,211,238,0.45)]",
    label: "text-cyan-600 dark:text-cyan-400/80",
    value: "text-cyan-700 dark:text-cyan-300",
    glow: "group-hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.55)]",
  },
  violet: {
    card: "border-violet-400/30 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent hover:border-violet-400/60 hover:shadow-[0_0_24px_-4px_rgba(167,139,250,0.45)]",
    label: "text-violet-600 dark:text-violet-400/80",
    value: "text-violet-700 dark:text-violet-300",
    glow: "group-hover:drop-shadow-[0_0_10px_rgba(167,139,250,0.55)]",
  },
  emerald: {
    card: "border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent hover:border-emerald-400/60 hover:shadow-[0_0_24px_-4px_rgba(52,211,153,0.45)]",
    label: "text-emerald-600 dark:text-emerald-400/80",
    value: "text-emerald-700 dark:text-emerald-300",
    glow: "group-hover:drop-shadow-[0_0_10px_rgba(52,211,153,0.55)]",
  },
  fuchsia: {
    card: "border-fuchsia-400/30 bg-gradient-to-br from-fuchsia-500/10 via-transparent to-transparent hover:border-fuchsia-400/60 hover:shadow-[0_0_24px_-4px_rgba(232,121,249,0.45)]",
    label: "text-fuchsia-600 dark:text-fuchsia-400/80",
    value: "text-fuchsia-700 dark:text-fuchsia-300",
    glow: "group-hover:drop-shadow-[0_0_10px_rgba(232,121,249,0.55)]",
  },
};

function StatCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  accent: Accent;
}) {
  const a = ACCENTS[accent];
  return (
    <Link
      href={href}
      className={`group block rounded-xl border bg-white dark:bg-zinc-900/60 p-5 backdrop-blur-sm transition-all duration-300 ${a.card}`}
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${a.label}`}>
        {label}
      </p>
      <p
        className={`mt-1 text-3xl font-semibold tracking-tight transition-all duration-300 ${a.value} ${a.glow}`}
      >
        {value}
      </p>
    </Link>
  );
}
