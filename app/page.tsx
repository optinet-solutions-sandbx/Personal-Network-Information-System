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
  const [extracted, setExtracted] = useState<ContactInput | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [story, setStory] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<ExtractNote | null>(null);
  const { listening, supported, toggle } = useSpeechRecognition({
    onResult: (text) => setStory((t) => (t ? `${t} ${text}` : text)),
  });

  // Possible-duplicate prompt: contacts matching the one being saved.
  const [dupes, setDupes] = useState<Contact[] | null>(null);

  async function handleExtract() {
    if (!story.trim()) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/contacts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: story }),
      });
      if (!res.ok) {
        setExtractNote({
          text: "AI extraction failed. No problem — fill the form in manually below.",
          tone: "warn",
        });
        return;
      }
      const { fields } = (await res.json()) as { fields: ContactInput };
      // Normalise all field values to strings to guard against LLM returning arrays/numbers
      const safe: ContactInput = {
        name: String(fields.name ?? ""),
        title: fields.title ? String(fields.title) : undefined,
        company: fields.company ? String(fields.company) : undefined,
        email: fields.email ? String(fields.email) : undefined,
        phone: fields.phone ? String(fields.phone) : undefined,
        location: fields.location ? String(fields.location) : undefined,
        tags: fields.tags ? String(fields.tags) : undefined,
        howWeMet: fields.howWeMet ? String(fields.howWeMet) : undefined,
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
    try {
      const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setContacts(data);
    } finally {
      setLoading(false);
    }
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
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extracted),
      });
      if (res.ok) {
        const contact = (await res.json()) as { id: string };
        if (story.trim()) {
          await fetch(`/api/contacts/${contact.id}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: story, source: "story" }),
          });
        }
        resetForm();
        setShowForm(false);
        setQuery("");
      }
    } finally {
      setSaving(false);
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
        <div className="mb-6 space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-indigo-900">
              ✨ Add contact
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

          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            placeholder="Tell me about this person — how you met, what they do, where they work…"
            rows={5}
            className="input w-full resize-y"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting || !story.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {extracting ? "Extracting…" : extracted ? "Re-extract" : "Extract"}
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
          {extractError && (
            <p className="text-xs text-red-600">{extractError}</p>
          )}

          {extracted && (
            <ExtractedCard extracted={extracted} onUpdate={setExtracted} />
          )}

          {extracted && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !extracted.name?.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save contact"}
            </button>
          )}
        </div>
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
                      {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
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

// ── Extracted fields card ───────────────────────────────────────────────────

const FIELD_DEFS: {
  key: keyof ContactInput;
  label: string;
  multiline?: boolean;
  isTags?: boolean;
}[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "tags", label: "Tags", isTags: true },
  { key: "howWeMet", label: "How we met", multiline: true },
];

function ExtractedCard({
  extracted,
  onUpdate,
}: {
  extracted: ContactInput;
  onUpdate: (updated: ContactInput) => void;
}) {
  const [editingField, setEditingField] = useState<keyof ContactInput | null>(
    null
  );
  const [showMissing, setShowMissing] = useState(false);

  function updateField(key: keyof ContactInput, value: string) {
    onUpdate({ ...extracted, [key]: value });
  }

  const missingFields = FIELD_DEFS.filter((f) => !extracted[f.key]);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
      <FieldRow
        label="Name *"
        value={extracted.name ?? ""}
        isRequired
        isEditing={editingField === "name"}
        onStartEdit={() => setEditingField("name")}
        onCommit={(v) => {
          updateField("name", v);
          setEditingField(null);
        }}
      />

      {FIELD_DEFS.map((f) => {
        const hasValue = Boolean(extracted[f.key]);
        if (!hasValue && !showMissing) return null;
        return (
          <FieldRow
            key={f.key}
            label={f.label}
            value={(extracted[f.key] as string) ?? ""}
            isEditing={editingField === f.key}
            multiline={f.multiline}
            isTags={f.isTags}
            onStartEdit={() => setEditingField(f.key)}
            onCommit={(v) => {
              updateField(f.key, v);
              setEditingField(null);
            }}
          />
        );
      })}

      {missingFields.length > 0 && (
        <button
          type="button"
          onClick={() => setShowMissing((s) => !s)}
          className="text-xs text-indigo-600 hover:underline"
        >
          {showMissing
            ? "− Hide empty fields"
            : `+ Add missing fields (${missingFields.length})`}
        </button>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
  isRequired,
  isEditing,
  multiline,
  isTags,
  onStartEdit,
  onCommit,
}: {
  label: string;
  value: string;
  isRequired?: boolean;
  isEditing: boolean;
  multiline?: boolean;
  isTags?: boolean;
  onStartEdit: () => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const escapedRef = useRef(false);
  useEffect(() => setDraft(value), [value]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !multiline) onCommit(draft);
    if (e.key === "Escape") {
      escapedRef.current = true;
      onCommit(value);
    }
  }

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </dt>
      {isEditing ? (
        multiline ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (!escapedRef.current) onCommit(draft); escapedRef.current = false; }}
            onKeyDown={handleKeyDown}
            rows={2}
            className="input mt-1 w-full resize-y"
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (!escapedRef.current) onCommit(draft); escapedRef.current = false; }}
            onKeyDown={handleKeyDown}
            className="input mt-1 w-full"
          />
        )
      ) : (
        <div
          role="button"
          onClick={onStartEdit}
          className="group mt-1 flex cursor-text items-center justify-between rounded px-1 py-0.5 hover:bg-zinc-50"
        >
          {isTags && value ? (
            <div className="flex flex-wrap gap-1">
              {value
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
            </div>
          ) : value ? (
            <span className="text-sm text-zinc-700">{value}</span>
          ) : (
            <span
              className={`text-sm italic ${
                isRequired ? "text-red-400" : "text-zinc-400"
              }`}
            >
              {isRequired ? "Not found — tap to add" : "—"}
            </span>
          )}
          <span className="ml-2 text-xs text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
            ✎
          </span>
        </div>
      )}
    </div>
  );
}
