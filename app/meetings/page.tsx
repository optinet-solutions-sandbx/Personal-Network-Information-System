"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type MatchedContact = { id: string; name: string };
type Meeting = {
  id: string;
  provider: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  htmlLink: string | null;
  matchedContacts: MatchedContact[];
  unknownAttendees: string[];
  followUpDone: boolean;
};
type ApiResponse = {
  calendarConnected: boolean;
  upcoming: Meeting[];
  followUps: Meeting[];
};

const PROVIDER_LABEL: Record<string, string> = { google: "Google Calendar", outlook: "Outlook" };

function formatWhen(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const date = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!endIso) return `${date} · ${time}`;
  const end = new Date(endIso);
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time} – ${endTime}`;
}

function relativeDay(iso: string): string | null {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return null;
}

export default function MeetingsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings");
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error || "Could not load meetings.");
      setData(body as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load meetings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markDone(m: Meeting) {
    setBusy(m.id);
    // Optimistic: drop it from the follow-up list immediately.
    setData((prev) =>
      prev ? { ...prev, followUps: prev.followUps.filter((x) => x.id !== m.id) } : prev
    );
    try {
      await fetch(`/api/meetings/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpDone: true }),
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-5">
        <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">Couldn’t load meetings</h2>
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  const upcoming = data?.upcoming ?? [];
  const followUps = data?.followUps ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Upcoming meetings with people in your network, and follow-ups after recent ones. Synced
          from your connected calendar.
        </p>
      </div>

      {!data?.calendarConnected && (
        <div className="mb-6 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-950/30 p-4 text-sm text-indigo-800 dark:text-indigo-300">
          No calendar connected yet. Connect{" "}
          <Link href="/connections" className="font-medium underline">
            Google Calendar or Outlook
          </Link>{" "}
          to see meeting prep and follow-ups here.
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-zinc-800 dark:text-zinc-100">
          🗓️ Upcoming — meeting prep
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No upcoming meetings with known contacts.
          </p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((m) => (
              <MeetingCard key={m.id} meeting={m} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-800 dark:text-zinc-100">
          ✅ Follow up after recent meetings
        </h2>
        {followUps.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            You’re all caught up — no pending follow-ups.
          </p>
        ) : (
          <ul className="space-y-3">
            {followUps.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                onDone={() => markDone(m)}
                busy={busy === m.id}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MeetingCard({
  meeting: m,
  onDone,
  busy,
}: {
  meeting: Meeting;
  onDone?: () => void;
  busy?: boolean;
}) {
  const rel = relativeDay(m.startsAt);
  return (
    <li className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-zinc-900 dark:text-zinc-50">{m.title}</h3>
            {rel && (
              <span className="shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                {rel}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {formatWhen(m.startsAt, m.endsAt)}
            {m.location ? ` · ${m.location}` : ""}
            {PROVIDER_LABEL[m.provider] ? ` · ${PROVIDER_LABEL[m.provider]}` : ""}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.matchedContacts.map((c) => (
              <Link
                key={c.id}
                href={`/contacts/${c.id}`}
                className="rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
              >
                {c.name}
              </Link>
            ))}
            {m.unknownAttendees.length > 0 && (
              <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs text-zinc-500 dark:text-zinc-400">
                +{m.unknownAttendees.length} not in your contacts
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {m.htmlLink && (
            <a
              href={m.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Open ↗
            </a>
          )}
          {onDone && (
            <button
              onClick={onDone}
              disabled={busy}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy ? "…" : "Mark done"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
