"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Contact, Note } from "@/lib/types";
import { Markdown } from "@/components/Markdown";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

export default function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/contacts/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setContact(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (notFound || !contact)
    return (
      <div>
        <p className="text-sm text-zinc-500">Contact not found.</p>
        <Link href="/" className="text-sm text-indigo-600">
          ← Back to contacts
        </Link>
      </div>
    );

  async function handleDelete() {
    if (!confirm(`Delete ${contact!.name}? This cannot be undone.`)) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    router.push("/");
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Link href="/" className="text-sm text-indigo-600">
          ← Back to contacts
        </Link>
        <DetailsCard contact={contact} onSaved={load} onDelete={handleDelete} />
        <NotesSection contact={contact} onChange={load} />
      </div>
      <div className="lg:col-span-2">
        <ProfileCard contact={contact} onChange={load} />
      </div>
    </div>
  );
}

/* ---------------- Details (view + edit) ---------------- */

function DetailsCard({
  contact,
  onSaved,
  onDelete,
}: {
  contact: Contact;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(contact);
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(contact), [contact]);

  async function save() {
    setSaving(true);
    await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        title: form.title,
        company: form.company,
        email: form.email,
        phone: form.phone,
        location: form.location,
        tags: form.tags,
        howWeMet: form.howWeMet,
      }),
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  const set = (k: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between">
        {editing ? (
          <input
            className="input text-xl font-semibold"
            value={form.name ?? ""}
            onChange={set("name")}
          />
        ) : (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {contact.name}
            </h1>
            <p className="text-sm text-zinc-500">
              {[contact.title, contact.company].filter(Boolean).join(" · ") ||
                "—"}
            </p>
          </div>
        )}
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => {
                  setForm(contact);
                  setEditing(false);
                }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
              >
                Edit
              </button>
              <button
                onClick={onDelete}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {(
          [
            ["title", "Title"],
            ["company", "Company"],
            ["email", "Email"],
            ["phone", "Phone"],
            ["location", "Location"],
            ["tags", "Tags"],
            ["howWeMet", "How we met"],
          ] as [keyof Contact, string][]
        ).map(([key, label]) => (
          <div key={key} className={key === "howWeMet" ? "col-span-2" : ""}>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              {label}
            </dt>
            {editing ? (
              <input
                className="input mt-1 w-full"
                value={(form[key] as string) ?? ""}
                onChange={set(key)}
              />
            ) : (
              <dd className="text-zinc-700">
                {(contact[key] as string) || "—"}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------------- Notes (CRUD + STT) ---------------- */

function NotesSection({
  contact,
  onChange,
}: {
  contact: Contact;
  onChange: () => void;
}) {
  const notes = contact.notes ?? [];
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const { listening, supported, toggle } = useSpeechRecognition({
    onResult: (text) =>
      setDraft((d) => (d ? `${d} ${text}` : text)),
  });

  async function addNote() {
    if (!draft.trim()) return;
    setSaving(true);
    await fetch(`/api/contacts/${contact.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: draft,
        source: listening ? "voice" : "manual",
      }),
    });
    setSaving(false);
    setDraft("");
    onChange();
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="mb-3 text-lg font-semibold">Notes</h2>

      <div className="rounded-lg border border-zinc-200 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a note, or use the mic to dictate…"
          rows={3}
          className="w-full resize-y text-sm outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
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
                : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            }`}
          >
            <span>{listening ? "● Listening… stop" : "🎤 Dictate"}</span>
          </button>
          <button
            onClick={addNote}
            disabled={saving || !draft.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {notes.length === 0 && (
          <li className="text-sm text-zinc-400">No notes yet.</li>
        )}
        {notes.map((n) => (
          <NoteItem key={n.id} note={n} onChange={onChange} />
        ))}
      </ul>
    </div>
  );
}

function NoteItem({ note, onChange }: { note: Note; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content);

  async function save() {
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    setEditing(false);
    onChange();
  }
  async function remove() {
    await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <li className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
      {editing ? (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="input w-full"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={save}
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
            >
              Save
            </button>
            <button
              onClick={() => {
                setText(note.content);
                setEditing(false);
              }}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-700">{note.content}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400">
            <span
              className={`rounded-full px-1.5 py-0.5 ${
                note.source === "voice"
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {note.source === "voice" ? "🎤 voice" : "manual"}
            </span>
            <span>{new Date(note.createdAt).toLocaleString()}</span>
            <button
              onClick={() => setEditing(true)}
              className="ml-auto text-indigo-600 hover:underline"
            >
              Edit
            </button>
            <button onClick={remove} className="text-red-500 hover:underline">
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}

/* ---------------- AI Profile ---------------- */

function ProfileCard({
  contact,
  onChange,
}: {
  contact: Contact;
  onChange: () => void;
}) {
  const [generating, setGenerating] = useState(false);

  async function generate() {
    setGenerating(true);
    await fetch(`/api/contacts/${contact.id}/profile`, { method: "POST" });
    setGenerating(false);
    onChange();
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">AI Profile</h2>
        <button
          onClick={generate}
          disabled={generating}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {generating
            ? "Generating…"
            : contact.profile
            ? "Regenerate"
            : "Generate"}
        </button>
      </div>

      {contact.profile ? (
        <>
          <div className="mt-3">
            <Markdown content={contact.profile} />
          </div>
          <p className="mt-4 border-t border-zinc-100 pt-3 text-xs text-zinc-400">
            Model: {contact.profileModel || "—"}
            {contact.profileUpdatedAt &&
              ` · ${new Date(contact.profileUpdatedAt).toLocaleString()}`}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-zinc-400">
          No profile yet. Generate an AI-assisted profile from this contact’s
          details and notes.
        </p>
      )}
    </div>
  );
}
