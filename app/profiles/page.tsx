"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/types";
import { Markdown } from "@/components/Markdown";

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

export default function ProfilesPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only contacts that have an AI profile; no `limit` => all of them.
    fetch("/api/contacts?hasProfile=true")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(data)) {
          throw new Error(
            (data && typeof data === "object" && data.error) ||
              "Could not load AI profiles."
          );
        }
        return data as Contact[];
      })
      .then(setContacts)
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : "Could not load AI profiles."
        )
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:text-indigo-600"
      >
        <span aria-hidden>←</span> Back to dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">AI Profiles</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {loading
            ? "AI-generated relationship summaries."
            : `${contacts.length} AI-generated ${
                contacts.length === 1 ? "profile" : "profiles"
              }, drawn from each contact's details and notes.`}
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
      ) : contacts.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400 dark:text-zinc-500">
          No AI profiles yet. Open a contact and generate one to see it here.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {contacts.map((c) => (
            <ProfileCard key={c.id} contact={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileCard({ contact }: { contact: Contact }) {
  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <Link
        href={`/contacts/${contact.id}`}
        className="group flex items-center gap-3"
      >
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(
            contact.name ?? ""
          )}`}
        >
          {(contact.name?.[0] ?? "?").toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600">
            {contact.name}
          </span>
          <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
            {[contact.title, contact.company].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
      </Link>

      <div className="mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
        {contact.profile ? (
          <Markdown content={contact.profile} />
        ) : (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No profile content.</p>
        )}
      </div>

      <p className="mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-3 text-xs text-zinc-400 dark:text-zinc-500">
        Model: {contact.profileModel || "—"}
        {contact.profileUpdatedAt &&
          ` · ${new Date(contact.profileUpdatedAt).toLocaleDateString()}`}
      </p>
    </div>
  );
}
