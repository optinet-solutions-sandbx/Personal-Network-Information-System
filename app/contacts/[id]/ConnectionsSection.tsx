"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import type { Contact } from "@/lib/types";
import {
  RELATIONSHIP_TYPES,
  relationshipLabel,
  type ConnectionView,
  type RelationshipType,
} from "@/lib/relationships";

// "Who knows whom" connections for one contact: lists existing edges and an
// inline form to link this contact to another. Lives on the contact detail page
// under Notes; the whole-network view is at /network.
export function ConnectionsSection({ contact }: { contact: Contact }) {
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/relationships?contactId=${contact.id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConnections((await res.json()) as ConnectionView[]);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [contact.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    const result = await Swal.fire({
      title: "Remove connection?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Remove",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      reverseButtons: true,
    });
    if (!result.isConfirmed) return;
    try {
      const res = await fetch(`/api/relationships/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch {
      await Swal.fire({ icon: "error", title: "Couldn't remove connection" });
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden>🕸️</span> Connections
          {connections.length > 0 && (
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {connections.length}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <Link
            href="/network"
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            View graph →
          </Link>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              + Link contact
            </button>
          )}
        </div>
      </div>

      {adding && (
        <AddConnectionForm
          contact={contact}
          onDone={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          No connections yet. Link {contact.name.split(" ")[0]} to people they know.
        </p>
      ) : (
        <ul className="space-y-2">
          {connections.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/contacts/${c.other.id}`}
                  className="text-sm font-medium text-zinc-800 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {c.other.name}
                </Link>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {/* For directional types, show direction relative to the focus */}
                  {c.outgoing ? relationshipLabel(c.type) : invertedLabel(c.type)}
                  {c.other.company ? ` · ${c.other.company}` : ""}
                  {c.note ? ` — ${c.note}` : ""}
                </p>
              </div>
              <StrengthDots value={c.strength} />
              <button
                onClick={() => remove(c.id)}
                aria-label="Remove connection"
                className="text-zinc-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Directional types read differently from the neighbour's side ("Reports to" ->
// "Manages"). Symmetric types read the same either way.
function invertedLabel(type: RelationshipType): string {
  const inverses: Partial<Record<RelationshipType, string>> = {
    introduced_by: "Introduced",
    manager: "Reports to",
    report: "Manages",
    mentor: "Mentored by",
    client: "Provides services to",
    investor: "Backed by",
  };
  return inverses[type] ?? relationshipLabel(type);
}

function StrengthDots({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" title={`Strength ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i <= value ? "bg-indigo-500" : "bg-zinc-200 dark:bg-zinc-700"
          }`}
        />
      ))}
    </span>
  );
}

function AddConnectionForm({
  contact,
  onDone,
  onSaved,
}: {
  contact: Contact;
  onDone: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [target, setTarget] = useState<Contact | null>(null);
  const [type, setType] = useState<RelationshipType>("knows");
  const [strength, setStrength] = useState(3);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search contacts to link to (excludes the current contact).
  useEffect(() => {
    if (target) return; // already picked
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/contacts?q=${encodeURIComponent(query)}&limit=8`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as Contact[];
        setResults(data.filter((c) => c.id !== contact.id));
      } catch {
        setResults([]);
      }
    }, 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, target, contact.id]);

  async function save() {
    if (!target) return;
    setSaving(true);
    try {
      const res = await fetch("/api/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromId: contact.id,
          toId: target.id,
          type,
          strength,
          note,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        await Swal.fire({ icon: "error", title: "Couldn't save", text: error || "" });
        return;
      }
      onSaved();
    } catch {
      await Swal.fire({ icon: "error", title: "Couldn't save connection" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-3">
      {!target ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Who does {contact.name.split(" ")[0]} know?
          </label>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts…"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
          />
          {results.length > 0 && (
            <ul className="mt-1 max-h-44 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setTarget(c)}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-zinc-400">
                      {[c.title, c.company].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex justify-end">
            <button
              onClick={onDone}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">{contact.name}</span>{" "}
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RelationshipType)}
              className="mx-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1 text-sm"
            >
              {RELATIONSHIP_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label.toLowerCase()}
                </option>
              ))}
            </select>{" "}
            <span className="font-medium">{target.name}</span>
            <button
              onClick={() => setTarget(null)}
              className="ml-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              change
            </button>
          </p>
          <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <span>Strength</span>
            <input
              type="range"
              min={1}
              max={5}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              className="accent-indigo-600"
            />
            <span className="tabular-nums">{strength}/5</span>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Context (optional) — e.g. met at DevCon 2025"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={onDone}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save connection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
