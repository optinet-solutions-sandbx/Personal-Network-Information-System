"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Contact, ContactInput } from "@/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

type ExtractNote = { text: string; tone: "ok" | "warn" };

// Fields a merge can copy from the new form into an existing contact.
const MERGEABLE: (keyof ContactInput)[] = [
  "email",
  "phone",
  "company",
  "title",
  "location",
  "tags",
  "howWeMet",
];

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
  const router = useRouter();
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
  const [extractNote, setExtractNote] = useState<ExtractNote | null>(null);
  const { listening, supported, toggle } = useSpeechRecognition({
    onResult: (text) => setAiText((t) => (t ? `${t} ${text}` : text)),
  });

  // Possible-duplicate prompt: contacts matching the one being saved.
  const [dupes, setDupes] = useState<Contact[] | null>(null);

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
        setExtractNote({
          text: "AI extraction failed. No problem — fill the form in manually below.",
          tone: "warn",
        });
        return;
      }
      const { fields, model } = (await res.json()) as {
        fields: ContactInput;
        model: string;
      };
      // Merge extracted values over the empty form, keeping anything truthy.
      setForm({ ...EMPTY, ...fields });

      // If the extractor came back with nothing usable, say so plainly and
      // hand off to manual entry rather than leaving a blank-looking form.
      const gotSomething = Object.values(fields).some(
        (v) => typeof v === "string" && v.trim()
      );
      if (!gotSomething) {
        setExtractNote({
          text: "AI couldn't pull any details from that. Try adding more, or just fill the form in manually below.",
          tone: "warn",
        });
        return;
      }

      setExtractNote({
        text:
          model === "fallback"
            ? "Extracted locally (no AI key set). Review and complete below."
            : "Extracted with AI. Review and edit below before saving.",
        tone: "ok",
      });
    } catch {
      // Network / unexpected failure — keep the typed text, guide to manual.
      setExtractNote({
        text: "Couldn't reach the AI service. Your text is kept — fill the form in manually below.",
        tone: "warn",
      });
    } finally {
      setExtracting(false);
    }
  }

  function resetForm() {
    setForm(EMPTY);
    setAiText("");
    setExtractNote(null);
    setDupes(null);
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

  // Persist the form as a brand-new contact.
  async function saveNew() {
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;

    // Check for an existing contact with the same name/email before saving,
    // so fast (especially voice) capture doesn't quietly create duplicates.
    setSaving(true);
    try {
      const params = new URLSearchParams({ name: form.name.trim() });
      if (form.email?.trim()) params.set("email", form.email.trim());
      const res = await fetch(`/api/contacts/check?${params}`);
      const matches: Contact[] = res.ok ? await res.json() : [];
      if (matches.length > 0) {
        setSaving(false);
        setDupes(matches);
        return;
      }
    } catch {
      // If the check itself fails, don't block the user — fall through to save.
    }
    setSaving(false);
    await saveNew();
  }

  // Merge the form into an existing contact: fill only the fields that are
  // currently empty on that contact, and append "how we met" if both differ.
  async function mergeInto(target: Contact) {
    const patch: Record<string, string> = {};
    for (const key of MERGEABLE) {
      const incoming = form[key]?.trim();
      if (!incoming) continue;
      const existing = (target[key] ?? "").trim();
      if (!existing) {
        patch[key] = incoming;
      } else if (key === "howWeMet" && !existing.includes(incoming)) {
        patch[key] = `${existing}; ${incoming}`;
      }
    }

    setSaving(true);
    const res = await fetch(`/api/contacts/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (res.ok) {
      resetForm();
      setShowForm(false);
      router.push(`/contacts/${target.id}`);
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
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting || !aiText.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {extracting ? "Extracting…" : "Extract details →"}
            </button>
            {(aiText.trim() || extractNote || form.name.trim()) && (
              <button
                type="button"
                onClick={resetForm}
                disabled={extracting}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                Clear / start over
              </button>
            )}
            {extractNote && (
              <span
                className={`text-xs ${
                  extractNote.tone === "warn"
                    ? "text-amber-700"
                    : "text-indigo-700"
                }`}
              >
                {extractNote.text}
              </span>
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

      {dupes && dupes.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">
            Possible duplicate{dupes.length === 1 ? "" : "s"} found
          </h2>
          <p className="mt-1 text-xs text-amber-800/90">
            You already have {dupes.length === 1 ? "a contact" : "contacts"} that
            match “{form.name.trim()}”. Merge the new details into an existing
            one, or save this as a separate contact.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {dupes.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {[d.title, d.company, d.email].filter(Boolean).join(" · ") ||
                      "—"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => mergeInto(d)}
                  disabled={saving}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                >
                  Merge into this
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setDupes(null);
                saveNew();
              }}
              disabled={saving}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save as new anyway"}
            </button>
            <button
              type="button"
              onClick={() => setDupes(null)}
              disabled={saving}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-700 disabled:opacity-50"
            >
              Keep editing
            </button>
          </div>
        </div>
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
