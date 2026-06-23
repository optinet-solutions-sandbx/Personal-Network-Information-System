"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import type { NetworkStats, Tally } from "@/lib/network-intel";

type Payload = { stats: NetworkStats; narrative: string; model: string };

const TIER_COLORS: Record<string, string> = {
  Strong: "bg-emerald-500",
  Active: "bg-sky-500",
  Fading: "bg-amber-500",
  Dormant: "bg-red-400",
  Unknown: "bg-zinc-400",
};

export default function NetworkIntelPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/network-intel", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Network Intelligence</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Trends and shape of your professional network.
          </p>
        </div>
        <Link
          href="/network"
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          ← Network map
        </Link>
      </div>

      {error ? (
        <p className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-sm text-zinc-500">
          Couldn&apos;t load network intelligence.
        </p>
      ) : !data ? (
        <p className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-sm text-zinc-400">
          Analyzing your network…
        </p>
      ) : (
        <div className="space-y-5">
          {/* Headline stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Contacts" value={data.stats.totalContacts} />
            <StatCard label="Connections" value={data.stats.connections} />
            <StatCard label="With notes" value={data.stats.withNotes} />
            <StatCard label="With birthday" value={data.stats.withBirthday} />
          </div>

          {/* AI narrative */}
          <section className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-5">
            <div className="mb-2 flex items-center gap-2">
              <span aria-hidden>✨</span>
              <h2 className="font-semibold">AI read on your network</h2>
              <span className="rounded-full bg-white/70 dark:bg-zinc-900/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {data.model === "fallback" || data.model === "none" ? "rule-based" : data.model}
              </span>
            </div>
            <div className="prose-sm max-w-none text-sm text-zinc-700 dark:text-zinc-200">
              <Markdown content={data.narrative} />
            </div>
          </section>

          {/* Distributions */}
          <div className="grid gap-4 md:grid-cols-2">
            <BarList title="Top companies" items={data.stats.topCompanies} accent="bg-indigo-500" />
            <BarList title="Top locations" items={data.stats.topLocations} accent="bg-sky-500" />
            <BarList title="Functional roles" items={data.stats.topRoles} accent="bg-violet-500" />
            <BarList title="Top tags" items={data.stats.topTags} accent="bg-teal-500" />
          </div>

          {/* Relationship health */}
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <h2 className="mb-3 font-semibold">Relationship health</h2>
            <HealthBar tiers={data.stats.healthTiers} total={data.stats.totalContacts} />
          </section>

          {/* Growth */}
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <h2 className="mb-3 font-semibold">New contacts · last 12 months</h2>
            <GrowthChart items={data.stats.growthByMonth} />
          </section>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function BarList({ title, items, accent }: { title: string; items: Tally[]; accent: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No data yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.label}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span className="truncate text-zinc-700 dark:text-zinc-200">{it.label}</span>
                <span className="tabular-nums text-zinc-400">{it.count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className={`h-full rounded-full ${accent}`}
                  style={{ width: `${(it.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
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
            <span className="text-zinc-600 dark:text-zinc-300">
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
