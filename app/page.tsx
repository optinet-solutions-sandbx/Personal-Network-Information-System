"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Contact, ContactInput } from "@/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

const EMPTY: ContactInput = {
  name: "",
  title: "",
  company: "",
  email: "",
  phone: "",
  location: "",
  tags: "",
  howWeMet: "",
};

export default function HomePage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ContactInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AI-assisted capture: freeform text / voice → extracted fields for review.
  const [aiText, setAiText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const { listening, supported, toggle } = useSpeechRecognition({
    onResult: (text) => setAiText((t) => (t ? `${t} ${text}` : text)),
  });

  async function handleExtract() {
    if (!aiText.trim()) return;
    setExtracting(true);
    setExtractNote(null);
    try {
      const res = await fetch("/api/contacts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText }),
      });
      if (!res.ok) {
        setExtractNote("Couldn't extract details — fill the form manually.");
        return;
      }
      const { fields, model } = (await res.json()) as {
        fields: ContactInput;
        model: string;
      };
      // Merge extracted values over the empty form, keeping anything truthy.
      setForm({ ...EMPTY, ...fields });
      setExtractNote(
        model === "fallback"
          ? "Extracted locally (no AI key set). Review and complete below."
          : "Extracted with AI. Review and edit below before saving."
      );
    } finally {
      setExtracting(false);
    }
  }

  function resetForm() {
    setForm(EMPTY);
    setAiText("");
    setExtractNote(null);
  }

  const load = useCallback(async (q: string) => {
    setLoading(true);
    const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setContacts(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(query), 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      resetForm();
      setShowForm(false);
      setQuery("");
      load("");
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-zinc-500">
            Your professional network, enriched with AI.
          </p>
        </div>
        <button
          onClick={() => {
            if (showForm) resetForm();
            setShowForm((s) => !s);
          }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {showForm ? "Cancel" : "+ Add contact"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-indigo-900">
              ✨ AI assist
            </h2>
            <button
              type="button"
              onClick={toggle}
              disabled={!supported}
              title={
                supported
                  ? "Dictate with speech-to-text"
                  : "Speech recognition not supported in this browser (try Chrome)"
              }
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                listening
                  ? "bg-red-600 text-white"
                  : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              }`}
            >
              {listening ? "● Listening… stop" : "🎤 Dictate"}
            </button>
          </div>
          <p className="mt-1 text-xs text-indigo-700/80">
            Type or dictate everything you know about the contact — AI will fill
            in the fields below for you to review.
          </p>
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder="e.g. Met Jane Doe at SaaStr 2026, intro by Mark. She's VP of Sales at Acme in San Francisco, jane@acme.com, +1 555 123 4567. Interested in fintech."
            rows={3}
            className="input mt-3 w-full resize-y"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting || !aiText.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {extracting ? "Extracting…" : "Extract details →"}
            </button>
            {extractNote && (
              <span className="text-xs text-indigo-700">{extractNote}</span>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-5 sm:grid-cols-2"
        >
          <Field label="Name *">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              placeholder="Jane Doe"
            />
          </Field>
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="input"
              placeholder="VP of Sales"
            />
          </Field>
          <Field label="Company">
            <input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="input"
              placeholder="Acme Inc."
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="input"
              placeholder="jane@acme.com"
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="input"
              placeholder="+1 555 123 4567"
            />
          </Field>
          <Field label="Location">
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="input"
              placeholder="San Francisco, CA"
            />
          </Field>
          <Field label="Tags (comma-separated)">
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className="input"
              placeholder="investor, fintech, warm-lead"
            />
          </Field>
          <Field label="How we met">
            <input
              value={form.howWeMet}
              onChange={(e) => setForm({ ...form, howWeMet: e.target.value })}
              className="input"
              placeholder="SaaStr 2026, intro by Mark"
            />
          </Field>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save contact"}
            </button>
          </div>
        </form>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, company, title, tag…"
        className="input mb-4 w-full"
      />

      {loading ? (
        <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>
      ) : contacts.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400">
          {query
            ? "No contacts match your search."
            : "No contacts yet. Add your first one above."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {contacts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contacts/${c.id}`}
                className="block rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-zinc-500">
                      {[c.title, c.company].filter(Boolean).join(" · ") ||
                        "—"}
                    </p>
                  </div>
                  {c.profile && (
                    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                      AI profile
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {(c.tags || "")
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
                      >
                        {t}
                      </span>
                    ))}
                  {c._count && (
                    <span className="ml-auto text-xs text-zinc-400">
                      {c._count.notes} note{c._count.notes === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-600">{label}</span>
      {children}
    </label>
  );
}
