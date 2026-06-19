"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Swal from "sweetalert2";
import type { Contact, Note, HealthInputs } from "@/lib/types";
import { Markdown } from "@/components/Markdown";
import { formatBirthday } from "@/lib/birthdays";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import HealthCard from "./HealthCard";

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
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // healthInputs is stored as a JSON string; parse it for HealthCard.
      if (typeof data.healthInputs === "string") {
        try {
          data.healthInputs = JSON.parse(data.healthInputs) as HealthInputs;
        } catch {
          data.healthInputs = null;
        }
      }
      setContact(data);
      setLoadError(false);
    } catch {
      // network failure or unexpected server error
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (loadError && !contact)
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600">
          Couldn&apos;t load this contact — check your connection and try again.
        </p>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Retry
        </button>
      </div>
    );
  if (notFound || !contact)
    return (
      <div>
        <p className="text-sm text-zinc-500">Contact not found.</p>
        <Link href="/contacts" className="text-sm text-indigo-600">
          ← Back to contacts
        </Link>
      </div>
    );

  async function handleDelete() {
    const result = await Swal.fire({
      title: "Delete Contact?",
      html: `<p style="font-size:0.875rem;color:#6b7280">This will permanently delete <strong>${contact!.name}</strong>. This cannot be undone.<br/><br/>Type <strong>delete</strong> below to confirm.</p>`,
      icon: "warning",
      input: "text",
      inputPlaceholder: "Type delete to confirm",
      inputAttributes: {
        autocapitalize: "off",
        autocorrect: "off",
        autocomplete: "off",
      },
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      reverseButtons: true,
      preConfirm: (value: string) => {
        const v = (value ?? "").trim().toLowerCase();
        if (v !== "delete" && v !== "confirm") {
          Swal.showValidationMessage('Please type "delete" to confirm.');
          return false;
        }
        return true;
      },
    });
    if (!result.isConfirmed) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    router.push("/contacts");
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Link href="/contacts" className="text-sm text-indigo-600">
          ← Back to contacts
        </Link>
        <DetailsCard contact={contact} onSaved={load} onDelete={handleDelete} />
        {contact.healthScore != null &&
          contact.healthTier != null &&
          contact.healthInputs != null && (
            <div className="mt-6">
              <HealthCard
                score={contact.healthScore}
                tier={contact.healthTier}
                inputs={contact.healthInputs as HealthInputs}
                contact={contact}
              />
            </div>
          )}
        <NotesSection contact={contact} onChange={load} />
      </div>
      <div className="lg:col-span-2">
        <ProfileCard contact={contact} onChange={load} />
      </div>
    </div>
  );
}

/* ---------------- Details (view + edit) ---------------- */

// Standard contact columns, rendered dynamically like the AI-detected fields.
const STANDARD_FIELDS: [keyof Contact, string][] = [
  ["title", "Title"],
  ["company", "Company"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["location", "Location"],
  ["tags", "Tags"],
  ["howWeMet", "How we met"],
];

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
  // Birthday is edited as a friendly string ("May 14"); the server re-normalizes
  // it to the canonical stored form on save.
  const [birthdayInput, setBirthdayInput] = useState(
    formatBirthday(contact.birthday)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(contact);
    setBirthdayInput(formatBirthday(contact.birthday));
  }, [contact]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
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
          birthday: birthdayInput,
          howWeMet: form.howWeMet,
          customFields: form.customFields,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        await Swal.fire({
          icon: "error",
          title: "Couldn't save changes",
          text: error || "Please check the fields and try again.",
        });
        return;
      }
      setEditing(false);
      onSaved();
      Swal.fire({
        title: "Saved!",
        text: `${form.name} has been updated.`,
        icon: "success",
        timer: 1800,
        showConfirmButton: false,
        timerProgressBar: true,
      });
    } catch {
      await Swal.fire({
        icon: "error",
        title: "Couldn't save changes",
        text: "Please check your connection and try again.",
      });
    } finally {
      setSaving(false);
    }
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
                  setBirthdayInput(formatBirthday(contact.birthday));
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
                id="edit-contact-btn"
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
        {STANDARD_FIELDS
          // In view mode only show fields the AI/user populated — same as the
          // AI-detected section. In edit mode show all so they can be filled in.
          .filter(([key]) => editing || (contact[key] as string)?.trim())
          .map(([key, label]) => (
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

        {(editing || contact.birthday) && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Birthday
            </dt>
            {editing ? (
              <input
                className="input mt-1 w-full"
                value={birthdayInput}
                placeholder="e.g. May 14 or 1990-05-14"
                onChange={(e) => setBirthdayInput(e.target.value)}
              />
            ) : (
              <dd className="text-zinc-700">
                {formatBirthday(contact.birthday) || "—"}
              </dd>
            )}
          </div>
        )}
      </dl>

      {/* AI-detected custom fields */}
      {((editing ? form : contact).customFields) &&
        Object.keys((editing ? form : contact).customFields!).length > 0 && (
          <div className="mt-5 pt-4 border-t border-zinc-100">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-400">
              ✦ AI-detected
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {Object.entries((editing ? form : contact).customFields!).map(
                ([key, value]) => (
                  <div
                    key={key}
                    className={
                      (value as string).length > 60 ? "col-span-2" : ""
                    }
                  >
                    <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      {key}
                    </dt>
                    {editing ? (
                      <input
                        className="input mt-1 w-full"
                        value={
                          (form.customFields as Record<string, string>)?.[
                            key
                          ] ?? ""
                        }
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customFields: {
                              ...(form.customFields as Record<string, string>),
                              [key]: e.target.value,
                            },
                          })
                        }
                      />
                    ) : (
                      <dd className="text-zinc-700">{(value as string) || "—"}</dd>
                    )}
                  </div>
                )
              )}
            </dl>
          </div>
        )}
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
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(notes.length / PAGE_SIZE));
  const visibleNotes = notes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const { listening, supported, toggle } = useSpeechRecognition({
    onResult: (text) =>
      setDraft((d) => (d ? `${d} ${text}` : text)),
  });

  async function addNote() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft,
          source: listening ? "voice" : "manual",
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        await Swal.fire({
          icon: "error",
          title: "Couldn't save note",
          text: error || "Please check your connection and try again.",
        });
        return;
      }
      setDraft("");
      onChange();
    } catch {
      await Swal.fire({
        icon: "error",
        title: "Couldn't save note",
        text: "Please check your connection and try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="mb-3 text-lg font-semibold">Notes</h2>

      <div className="rounded-lg border border-zinc-200 p-3">
        <textarea
          id="notes-textarea"
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
        {visibleNotes.map((n) => (
          <NoteItem key={n.id} note={n} onChange={() => { onChange(); setPage(1); }} />
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
          <span>{notes.length} notes · page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md border border-zinc-200 px-2.5 py-1 hover:bg-zinc-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`rounded-md border px-2.5 py-1 ${
                  p === page
                    ? "border-indigo-300 bg-indigo-50 text-indigo-600 font-semibold"
                    : "border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md border border-zinc-200 px-2.5 py-1 hover:bg-zinc-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteItem({ note, onChange }: { note: Note; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content);

  async function save() {
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        await Swal.fire({
          icon: "error",
          title: "Couldn't update note",
          text: error || "Please try again.",
        });
        return;
      }
      setEditing(false);
      onChange();
    } catch {
      await Swal.fire({
        icon: "error",
        title: "Couldn't update note",
        text: "Please check your connection and try again.",
      });
    }
  }
  async function remove() {
    const result = await Swal.fire({
      title: "Delete Note?",
      html: '<p style="font-size:0.875rem;color:#6b7280">Are you sure you want to delete this note? This cannot be undone.</p>',
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      reverseButtons: true,
    });
    if (!result.isConfirmed) return;
    try {
      const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChange();
    } catch {
      await Swal.fire({
        icon: "error",
        title: "Couldn't delete note",
        text: "Please check your connection and try again.",
      });
    }
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
                  : note.source === "story"
                  ? "bg-indigo-50 text-indigo-600"
                  : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {note.source === "voice"
                ? "🎤 voice"
                : note.source === "story"
                ? "📖 story"
                : "manual"}
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
    if (contact.profile) {
      const result = await Swal.fire({
        title: "Profile Already Generated",
        html: `<p style="font-size:0.875rem;color:#6b7280">An AI profile for <strong>${contact.name}</strong> already exists. Do you want to regenerate it? This will overwrite the current profile.</p>`,
        icon: "info",
        showCancelButton: true,
        confirmButtonText: "Regenerate",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#4f46e5",
        cancelButtonColor: "#6b7280",
        reverseButtons: true,
      });
      if (!result.isConfirmed) return;
    }
    setGenerating(true);
    Swal.fire({
      title: "Generating AI Profile...",
      html: `<p style="font-size:0.875rem;color:#6b7280">Analysing details and notes for <strong>${contact.name}</strong></p>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await fetch(`/api/contacts/${contact.id}/profile`, {
        method: "POST",
      });
      Swal.close();
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        await Swal.fire({
          icon: res.status === 429 ? "warning" : "error",
          title:
            res.status === 429
              ? "Slow down a moment"
              : "Profile generation failed",
          text:
            error ||
            "The AI service may be unavailable. Please try again in a moment.",
        });
        return;
      }
      onChange();
    } catch {
      Swal.close();
      await Swal.fire({
        icon: "error",
        title: "Profile generation failed",
        text: "Please check your connection and try again.",
      });
    } finally {
      setGenerating(false);
    }
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
