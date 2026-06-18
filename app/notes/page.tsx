"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Note } from "@/lib/types";

// A note with the minimal parent-contact reference returned by GET /api/notes.
type NoteWithContact = Note & {
  contact: {
    id: string;
    name: string;
    company: string | null;
    title: string | null;
  } | null;
};

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

function sourceBadge(source: Note["source"]) {
  if (source === "voice")
    return { label: "🎤 voice", className: "bg-emerald-50 text-emerald-600" };
  if (source === "story")
    return { label: "📖 story", className: "bg-indigo-50 text-indigo-600" };
  return { label: "manual", className: "bg-zinc-100 text-zinc-500" };
}

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteWithContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notes")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(data)) {
          throw new Error(
            (data && typeof data === "object" && data.error) ||
              "Could not load notes."
          );
        }
        return data as NoteWithContact[];
      })
      .then(setNotes)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load notes.")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-indigo-600"
      >
        <span aria-hidden>←</span> Back to dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <p className="text-sm text-zinc-500">
          Every note across your network, newest first.
        </p>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      ) : notes.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => {
            const badge = sourceBadge(n.source);
            const name = n.contact?.name ?? "Unknown contact";
            return (
              <li
                key={n.id}
                className="rounded-xl border border-zinc-200 bg-white p-4"
              >
                {n.contact ? (
                  <Link
                    href={`/contacts/${n.contact.id}`}
                    className="group flex items-center gap-2.5"
                  >
                    <span
                      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarColor(
                        name
                      )}`}
                    >
                      {(name[0] ?? "?").toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-800 group-hover:text-indigo-600">
                        {name}
                      </span>
                      <span className="block truncate text-xs text-zinc-400">
                        {[n.contact.title, n.contact.company]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-zinc-500">
                    {name}
                  </span>
                )}

                <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">
                  {n.content}
                </p>

                <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400">
                  <span className={`rounded-full px-1.5 py-0.5 ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span>{new Date(n.createdAt).toLocaleString()}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
