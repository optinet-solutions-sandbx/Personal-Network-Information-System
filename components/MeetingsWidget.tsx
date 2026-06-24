"use client";

// Compact dashboard surface for meeting prep + follow-ups. Reads /api/meetings
// and renders a short list of the next upcoming meetings and pending follow-ups,
// each linking through to the full /meetings page. Renders nothing until loaded
// and stays quiet (a slim hint) when there's nothing actionable, so it never
// clutters the dashboard for users without a connected calendar.

import { useEffect, useState } from "react";
import Link from "next/link";

type MatchedContact = { id: string; name: string };
type Meeting = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  matchedContacts: MatchedContact[];
};
type ApiResponse = {
  calendarConnected: boolean;
  upcoming: Meeting[];
  followUps: Meeting[];
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return `Today · ${time}`;
  if (diff === 1) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}

export default function MeetingsWidget() {
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    fetch("/api/meetings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  const upcoming = data.upcoming.slice(0, 3);
  const followUpCount = data.followUps.length;

  // Nothing connected and nothing to show → a single quiet prompt.
  if (!data.calendarConnected && upcoming.length === 0 && followUpCount === 0) {
    return null;
  }
  if (upcoming.length === 0 && followUpCount === 0) return null;

  return (
    <div className="rounded-xl border border-indigo-400/30 bg-white bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent p-5 backdrop-blur-sm shadow-[0_0_24px_-8px_rgba(129,140,248,0.35)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-indigo-700">🗓️ Meetings</h2>
        <Link href="/meetings" className="text-xs font-medium text-indigo-600 hover:underline">
          View all →
        </Link>
      </div>

      {followUpCount > 0 && (
        <Link
          href="/meetings"
          className="mb-3 block rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 transition-colors hover:bg-amber-100"
        >
          {followUpCount} follow-up{followUpCount === 1 ? "" : "s"} waiting after recent meetings →
        </Link>
      )}

      {upcoming.length === 0 ? (
        <p className="text-sm text-zinc-400">No upcoming meetings with known contacts.</p>
      ) : (
        <ul className="space-y-1">
          {upcoming.map((m) => (
            <li key={m.id}>
              <Link
                href="/meetings"
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-zinc-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-800">
                    {m.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-400">
                    with {m.matchedContacts.map((c) => c.name).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-zinc-400">
                  {formatWhen(m.startsAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
