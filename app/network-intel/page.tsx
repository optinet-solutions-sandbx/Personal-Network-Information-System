"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import type { NetworkStats, Tally } from "@/lib/network-intel";

type StatsPayload = { stats: NetworkStats };
type NarrativePayload = { narrative: string; model: string };

const TIER_COLORS: Record<string, string> = {
  Strong: "bg-emerald-500",
  Active: "bg-sky-500",
  Fading: "bg-amber-500",
  Dormant: "bg-red-400",
  Unknown: "bg-zinc-400",
};

// Each headline metric links somewhere and carries its own accent so the four
// cards read as distinct at a glance. Class strings are spelled out (not built
// dynamically) so Tailwind keeps them through the production purge.
type StatTheme = {
  border: string;
  glow: string;
  line: string;
  iconBg: string;
  value: string;
};

const STAT_CARDS: {
  key: "totalContacts" | "connections" | "withNotes" | "withBirthday";
  label: string;
  href: string;
  theme: StatTheme;
  icon: React.ReactNode;
}[] = [
  {
    key: "totalContacts",
    label: "Contacts",
    href: "/contacts",
    theme: {
      border: "border-indigo-200/70 hover:border-indigo-400",
      glow: "bg-indigo-500/40 shadow-[0_0_30px_-6px_rgba(99,102,241,0.55)]",
      line: "from-transparent via-indigo-500 to-transparent",
      iconBg: "bg-indigo-500/10 text-indigo-600",
      value: "from-indigo-600 to-violet-400",
    },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M17 20v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8m14 10v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "connections",
    label: "Connections",
    href: "/network",
    theme: {
      border: "border-cyan-200/70 hover:border-cyan-400",
      glow: "bg-cyan-500/40 shadow-[0_0_30px_-6px_rgba(6,182,212,0.55)]",
      line: "from-transparent via-cyan-500 to-transparent",
      iconBg: "bg-cyan-500/10 text-cyan-600",
      value: "from-cyan-500 to-sky-400",
    },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="2" />
        <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="18" r="2.5" stroke="currentColor" strokeWidth="2" />
        <path d="M7.7 7.7 10.3 16M16.3 7.7 13.7 16M8 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "withNotes",
    label: "With notes",
    href: "/notes",
    theme: {
      border: "border-emerald-200/70 hover:border-emerald-400",
      glow: "bg-emerald-500/40 shadow-[0_0_30px_-6px_rgba(16,185,129,0.55)]",
      line: "from-transparent via-emerald-500 to-transparent",
      iconBg: "bg-emerald-500/10 text-emerald-600",
      value: "from-emerald-500 to-teal-400",
    },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 4h16v12l-4 4H4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "withBirthday",
    label: "With birthday",
    href: "/birthdays",
    theme: {
      border: "border-amber-200/70 hover:border-amber-400",
      glow: "bg-amber-500/40 shadow-[0_0_30px_-6px_rgba(245,158,11,0.55)]",
      line: "from-transparent via-amber-500 to-transparent",
      iconBg: "bg-amber-500/10 text-amber-600",
      value: "from-amber-500 to-orange-400",
    },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M4 16c1.5 0 1.5-1.2 3-1.2s1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2M12 8V5M12 3.5l.01 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

// Bar-fill gradients for the distribution lists — one accent per list.
const BAR_GRADIENTS = {
  indigo: "from-indigo-500 to-violet-400",
  sky: "from-sky-500 to-cyan-400",
  violet: "from-violet-500 to-fuchsia-400",
  teal: "from-teal-500 to-emerald-400",
} as const;

export default function NetworkIntelPage() {
  const [data, setData] = useState<StatsPayload | null>(null);
  const [error, setError] = useState(false);
  // The AI narrative loads on its own (it's the slow part); the rest of the
  // page doesn't wait for it.
  const [narrative, setNarrative] = useState<NarrativePayload | null>(null);
  const [narrativeError, setNarrativeError] = useState(false);

  useEffect(() => {
    fetch("/api/network-intel", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));

    fetch("/api/network-intel/narrative", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setNarrative)
      .catch(() => setNarrativeError(true));
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Network Intelligence</h1>
          <p className="text-sm text-zinc-500">
            Trends and shape of your professional network.
          </p>
        </div>
        <Link
          href="/network"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
        >
          ← Network map
        </Link>
      </div>

      {error ? (
        <p className="rounded-xl border border-zinc-200 p-8 text-center text-sm text-zinc-500">
          Couldn&apos;t load network intelligence.
        </p>
      ) : !data ? (
        <p className="rounded-xl border border-zinc-200 p-8 text-center text-sm text-zinc-400">
          Analyzing your network…
        </p>
      ) : (
        <div className="space-y-5">
          {/* Headline stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STAT_CARDS.map((card) => (
              <StatCard
                key={card.label}
                label={card.label}
                value={data.stats[card.key]}
                href={card.href}
                theme={card.theme}
                icon={card.icon}
              />
            ))}
          </div>

          {/* AI narrative — loads independently of the stats above */}
          <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
            <div className="mb-2 flex items-center gap-2">
              <span aria-hidden>✨</span>
              <h2 className="font-semibold">AI read on your network</h2>
              {narrative && (
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  {narrative.model === "fallback" || narrative.model === "none"
                    ? "rule-based"
                    : narrative.model}
                </span>
              )}
            </div>
            {narrativeError ? (
              <p className="text-sm text-zinc-500">
                Couldn&apos;t generate the AI read right now.
              </p>
            ) : !narrative ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                Analyzing your network…
              </div>
            ) : (
              <div className="prose-sm max-w-none text-sm text-zinc-700">
                <Markdown content={narrative.narrative} />
              </div>
            )}
          </section>

          {/* Distributions */}
          <div className="grid gap-4 md:grid-cols-2">
            <BarList title="Top companies" items={data.stats.topCompanies} accent={BAR_GRADIENTS.indigo} searchable />
            <BarList title="Top locations" items={data.stats.topLocations} accent={BAR_GRADIENTS.sky} searchable />
            <BarList title="Functional roles" items={data.stats.topRoles} accent={BAR_GRADIENTS.violet} />
            <BarList title="Top tags" items={data.stats.topTags} accent={BAR_GRADIENTS.teal} searchable />
          </div>

          {/* Relationship health */}
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">Relationship health</h2>
            <HealthBar tiers={data.stats.healthTiers} total={data.stats.totalContacts} />
          </section>

          {/* Growth */}
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">New contacts · last 12 months</h2>
            <GrowthChart items={data.stats.growthByMonth} />
          </section>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  theme,
  icon,
}: {
  label: string;
  value: number;
  href: string;
  theme: StatTheme;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-white/80 p-4 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 ${theme.border}`}
    >
      {/* Neon corner glow — intensifies on hover */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-100 ${theme.glow}`}
      />
      {/* Top accent line */}
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r opacity-70 transition-opacity duration-300 group-hover:opacity-100 ${theme.line}`}
      />
      <div className="relative flex items-center justify-between">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${theme.iconBg}`}>
          {icon}
        </span>
        <span className="text-zinc-300 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <p
        className={`relative bg-gradient-to-br bg-clip-text text-3xl font-bold tabular-nums text-transparent ${theme.value}`}
      >
        {value}
      </p>
      <p className="relative text-xs text-zinc-500">{label}</p>
    </Link>
  );
}

function BarList({
  title,
  items,
  accent,
  searchable = false,
}: {
  title: string;
  items: Tally[];
  accent: string;
  searchable?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-400">No data yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const row = (
              <>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span
                    className={`truncate text-zinc-700 ${
                      searchable ? "group-hover/bar:text-indigo-600" : ""
                    }`}
                  >
                    {it.label}
                  </span>
                  <span className="tabular-nums text-zinc-400">{it.count}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${accent} transition-all duration-300 ${
                      searchable ? "group-hover/bar:brightness-110" : ""
                    }`}
                    style={{ width: `${(it.count / max) * 100}%` }}
                  />
                </div>
              </>
            );
            return (
              <li key={it.label}>
                {searchable ? (
                  <Link
                    href={`/contacts?q=${encodeURIComponent(it.label)}`}
                    className="group/bar block rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-zinc-50"
                    title={`View contacts matching “${it.label}”`}
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HealthBar({ tiers, total }: { tiers: Tally[]; total: number }) {
  if (total === 0) return <p className="text-sm text-zinc-400">No contacts yet.</p>;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        {tiers.map((t) => (
          <div
            key={t.label}
            className={TIER_COLORS[t.label] ?? "bg-zinc-400"}
            style={{ width: `${(t.count / total) * 100}%` }}
            title={`${t.label}: ${t.count}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {tiers.map((t) => (
          <span key={t.label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${TIER_COLORS[t.label] ?? "bg-zinc-400"}`} />
            <span className="text-zinc-600">
              {t.label} <span className="tabular-nums text-zinc-400">{t.count}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function GrowthChart({ items }: { items: Tally[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="flex items-end gap-1.5" style={{ height: 120 }}>
      {items.map((m) => (
        <div key={m.label} className="flex flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] tabular-nums text-zinc-400">{m.count || ""}</span>
          <div
            className="w-full rounded-t bg-indigo-500/80"
            style={{ height: `${(m.count / max) * 90}%`, minHeight: m.count ? 4 : 0 }}
            title={`${m.label}: ${m.count}`}
          />
          <span className="text-[9px] text-zinc-400">{m.label.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
