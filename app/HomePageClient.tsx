"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Contact, ContactInput } from "@/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { formatBirthday, liftBirthdayFromCustomFields } from "@/lib/birthdays";

// A possible duplicate returned by /api/contacts/check (name or email match).
type MatchContact = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  title: string | null;
  _count?: { notes: number };
};

export default function HomePageClient() {
  const router = useRouter();
  const [extracted, setExtracted] = useState<ContactInput | null>(null);
  const [enrichedKeys, setEnrichedKeys] = useState<string[]>([]);
  const [enrichedContact, setEnrichedContact] = useState<string[]>([]);
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  const [enrich, setEnrich] = useState(true);
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<MatchContact[]>([]);
  const [story, setStory] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  // The AI ran successfully but found nothing usable — prompt manual entry
  // instead of dropping the user into a blank, confusing review form.
  const [noFields, setNoFields] = useState(false);
  // The user chose to fill the contact in by hand — show every field upfront.
  const [manualEntry, setManualEntry] = useState(false);
  const { listening, supported, toggle } = useSpeechRecognition({
    onResult: (text) => setStory((t) => (t ? `${t} ${text}` : text)),
  });

  async function handleExtract() {
    if (!story.trim()) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/contacts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: story, enrich }),
      });
      if (!res.ok) {
        setExtractError(
          res.status === 429
            ? "You're going a bit fast — please wait a moment and try again."
            : "Couldn't extract details — try rephrasing or extracting again."
        );
        return;
      }
      const {
        fields,
        enriched,
        enrichedContact: enrichedC,
        sources: srcs,
      } = (await res.json()) as {
        fields: ContactInput;
        enriched?: string[];
        enrichedContact?: string[];
        sources?: { title: string; url: string }[];
      };
      // A birthday may arrive as a top-level field or buried in customFields
      // (e.g. "Born"/"Birthday"); lift it into the structured field either way.
      const lifted = liftBirthdayFromCustomFields(fields.customFields);
      const safe: ContactInput = {
        name: String(fields.name ?? ""),
        title: fields.title ? String(fields.title) : undefined,
        company: fields.company ? String(fields.company) : undefined,
        email: fields.email ? String(fields.email) : undefined,
        phone: fields.phone ? String(fields.phone) : undefined,
        location: fields.location ? String(fields.location) : undefined,
        tags: fields.tags ? String(fields.tags) : undefined,
        birthday: fields.birthday
          ? String(fields.birthday)
          : lifted.birthday
          ? formatBirthday(lifted.birthday)
          : undefined,
        howWeMet: fields.howWeMet ? String(fields.howWeMet) : undefined,
        customFields:
          lifted.customFields && Object.keys(lifted.customFields).length > 0
            ? lifted.customFields
            : undefined,
      };
      setExtracted(safe);
      setNoFields(!hasUsableFields(safe));
      setManualEntry(false);
      setEnrichedKeys(
        Array.isArray(enriched) ? enriched.filter((k) => k in (safe.customFields ?? {})) : []
      );
      setEnrichedContact(Array.isArray(enrichedC) ? enrichedC : []);
      setSources(Array.isArray(srcs) ? srcs : []);
      setExtractError(null);
    } finally {
      setExtracting(false);
    }
  }

  function resetForm() {
    setStory("");
    setExtracted(null);
    setNoFields(false);
    setManualEntry(false);
    setEnrichedKeys([]);
    setEnrichedContact([]);
    setSources([]);
    setExtractError(null);
    setDuplicates([]);
  }

  // Attach the original story (if any) as a note, then go to the contact.
  async function attachStoryAndGo(contactId: string) {
    if (story.trim()) {
      await fetch(`/api/contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: story, source: "story" }),
      });
    }
    router.push(`/contacts/${contactId}`);
  }

  // Save flow. Unless `force` is set, first checks for an existing contact with
  // the same name or email and surfaces a merge / save-anyway prompt instead.
  async function handleSave(force = false) {
    if (!extracted?.name?.trim()) return;
    setSaving(true);
    try {
      if (!force) {
        const params = new URLSearchParams();
        params.set("name", extracted.name.trim());
        if (extracted.email?.trim()) params.set("email", extracted.email.trim());
        const dupRes = await fetch(`/api/contacts/check?${params.toString()}`);
        if (dupRes.ok) {
          const matches = (await dupRes.json()) as MatchContact[];
          if (matches.length > 0) {
            setDuplicates(matches);
            return; // wait for the user to choose merge / save anyway
          }
        }
      }

      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extracted),
      });
      if (res.ok) {
        const contact = (await res.json()) as { id: string };
        await attachStoryAndGo(contact.id);
      }
    } finally {
      setSaving(false);
    }
  }

  // Merge the extracted details into an existing contact: gap-fill empty
  // standard fields, union tags, add new custom fields (never overwriting
  // existing values), then attach the story note.
  async function handleMerge(target: MatchContact) {
    if (!extracted) return;
    setSaving(true);
    try {
      const existingRes = await fetch(`/api/contacts/${target.id}`);
      const existing = existingRes.ok ? ((await existingRes.json()) as Contact) : null;

      const patch: Record<string, unknown> = {};
      const gapFields = ["email", "phone", "company", "title", "location", "birthday", "howWeMet"] as const;
      for (const f of gapFields) {
        const incoming = extracted[f]?.trim();
        if (incoming && !existing?.[f]) patch[f] = incoming;
      }

      const tags = unionTags(existing?.tags ?? null, extracted.tags);
      if (tags && tags !== (existing?.tags ?? null)) patch.tags = tags;

      // Existing values win on key conflicts — extracted only fills gaps.
      const mergedCustom = {
        ...(extracted.customFields ?? {}),
        ...(existing?.customFields ?? {}),
      };
      if (Object.keys(mergedCustom).length > 0) patch.customFields = mergedCustom;

      if (Object.keys(patch).length > 0) {
        await fetch(`/api/contacts/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      }

      await attachStoryAndGo(target.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Add Contact</h1>
        <p className="text-sm text-zinc-500">
          Tell me about someone you met and I'll extract their details.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-indigo-900">✨ New contact</h2>
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

        <div>
          <p className="mb-2 text-xs text-zinc-500">
            Tell me about this person — how you met, what they do, where they work…
          </p>
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            placeholder="e.g. I met Sarah Chen at SaaStr. She's VP of Product at Acme Corp in San Francisco. We talked about AI tooling for enterprise sales teams. She loves hiking and is learning Portuguese."
            rows={5}
            className="input w-full resize-y"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExtract}
            disabled={extracting || !story.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {extracting ? "Extracting…" : extracted ? "Re-extract" : "Extract"}
          </button>
          {(story.trim() || extracted) && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              Clear
            </button>
          )}
          {extracting && (
            <span className="text-xs text-indigo-600 animate-pulse">
              Analysing story…
            </span>
          )}
        </div>

        <label className="flex items-start gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={enrich}
            onChange={(e) => setEnrich(e.target.checked)}
            className="mt-0.5 accent-indigo-600"
          />
          <span>
            <span className="font-medium text-zinc-700">
              🌐 Enrich from the web
            </span>
            <span className="block text-zinc-400">
              Searches the public web for this person (works for anyone with a
              public footprint) and adds cited details — role, bio, interests.
              May be outdated; verify before trusting. Never collects private
              email, phone, or home address.
            </span>
          </span>
        </label>

        {extractError && (
          <p className="text-xs text-red-600">{extractError}</p>
        )}

        {extracted && noFields && (
          <EmptyExtraction
            onManual={() => {
              setManualEntry(true);
              setNoFields(false);
            }}
          />
        )}

        {extracted && !noFields && (
          <ReviewCard
            extracted={extracted}
            enrichedKeys={enrichedKeys}
            enrichedContact={enrichedContact}
            sources={sources}
            startExpanded={manualEntry}
            onUpdate={setExtracted}
            onSave={() => handleSave()}
            saving={saving}
          />
        )}
      </div>

      {duplicates.length > 0 && (
        <DuplicatePrompt
          duplicates={duplicates}
          saving={saving}
          onMerge={handleMerge}
          onSaveAnyway={() => handleSave(true)}
          onCancel={() => setDuplicates([])}
        />
      )}
    </div>
  );
}

// True when extraction produced at least one thing worth reviewing — a name,
// any standard field, or a custom field. When false, we surface a clear
// "nothing found" message instead of an empty review form.
function hasUsableFields(c: ContactInput): boolean {
  if (c.name?.trim()) return true;
  const standard: (keyof Omit<ContactInput, "customFields">)[] = [
    "title",
    "company",
    "email",
    "phone",
    "location",
    "birthday",
    "tags",
    "howWeMet",
  ];
  if (standard.some((k) => c[k]?.trim())) return true;
  return Object.keys(c.customFields ?? {}).length > 0;
}

// Shown when the AI returns nothing usable. Explains what happened and offers
// an explicit fall-back to manual entry so the user is never stuck.
function EmptyExtraction({ onManual }: { onManual: () => void }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        I couldn't find any contact details
      </p>
      <p className="mt-1 text-xs text-amber-700">
        Nothing in that text looked like a name, role, or other detail. Try
        adding more — a name, where they work, how you met — and extract again,
        or enter the details yourself.
      </p>
      <div className="mt-3">
        <button
          type="button"
          onClick={onManual}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
        >
          Enter details manually
        </button>
      </div>
    </div>
  );
}

// Union two comma-separated tag strings, case-insensitively de-duped, keeping
// the existing order first. Returns null when both are empty.
function unionTags(existing: string | null, incoming?: string): string | null {
  const split = (s?: string | null) =>
    (s ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...split(existing), ...split(incoming)]) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out.length > 0 ? out.join(", ") : null;
}

// ── Duplicate prompt ──────────────────────────────────────────────────────────

function DuplicatePrompt({
  duplicates,
  saving,
  onMerge,
  onSaveAnyway,
  onCancel,
}: {
  duplicates: MatchContact[];
  saving: boolean;
  onMerge: (target: MatchContact) => void;
  onSaveAnyway: () => void;
  onCancel: () => void;
}) {
  const plural = duplicates.length > 1;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-100 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-900">
            Possible duplicate{plural ? "s" : ""} found
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {plural
              ? "These contacts share this name or email. Merge into one to keep things tidy, or save as a new contact anyway."
              : "A contact with this name or email already exists. Merge into it to keep things tidy, or save as a new contact anyway."}
          </p>
        </div>

        <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto px-5">
          {duplicates.map((d) => {
            const subtitle = [d.title, d.company].filter(Boolean).join(" · ");
            return (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800">{d.name}</p>
                  {(subtitle || d.email) && (
                    <p className="truncate text-xs text-zinc-500">
                      {subtitle}
                      {subtitle && d.email ? " · " : ""}
                      {d.email}
                    </p>
                  )}
                  {d._count && (
                    <p className="text-[11px] text-zinc-400">
                      {d._count.notes} note{d._count.notes !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onMerge(d)}
                  disabled={saving}
                  className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50"
                >
                  Merge here
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveAnyway}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save as new anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Review card ─────────────────────────────────────────────────────────────

const STANDARD_FIELDS: {
  key: keyof Omit<ContactInput, "customFields">;
  label: string;
  multiline?: boolean;
  isTags?: boolean;
  placeholder?: string;
}[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "birthday", label: "Birthday", placeholder: "MM-DD or MM-DD-YYYY" },
  { key: "tags", label: "Tags", isTags: true },
  { key: "howWeMet", label: "How we met", multiline: true },
];

function ReviewCard({
  extracted,
  enrichedKeys = [],
  enrichedContact = [],
  sources = [],
  startExpanded = false,
  onUpdate,
  onSave,
  saving,
}: {
  extracted: ContactInput;
  enrichedKeys?: string[];
  enrichedContact?: string[];
  sources?: { title: string; url: string }[];
  startExpanded?: boolean;
  onUpdate: (updated: ContactInput) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(startExpanded);

  function updateStandardField(
    key: keyof Omit<ContactInput, "customFields">,
    value: string
  ) {
    onUpdate({ ...extracted, [key]: value });
  }

  function updateCustomField(key: string, value: string) {
    onUpdate({
      ...extracted,
      customFields: { ...(extracted.customFields ?? {}), [key]: value },
    });
  }

  function removeCustomField(key: string) {
    const rest = { ...(extracted.customFields ?? {}) };
    delete rest[key];
    onUpdate({
      ...extracted,
      customFields: Object.keys(rest).length > 0 ? rest : undefined,
    });
  }

  const hasName = Boolean(extracted.name?.trim());
  const filledStandard = STANDARD_FIELDS.filter((f) => Boolean(extracted[f.key]));
  const missingStandard = STANDARD_FIELDS.filter((f) => !extracted[f.key]);
  const customEntries = Object.entries(extracted.customFields ?? {});
  const enrichedSet = new Set(enrichedKeys);
  const detectedEntries = customEntries.filter(([k]) => !enrichedSet.has(k));
  const enrichedEntries = customEntries.filter(([k]) => enrichedSet.has(k));
  const totalFields = 1 + filledStandard.length + customEntries.length;

  const renderCustomRow = ([key, value]: [string, string]) => (
    <div key={key} className="flex items-start gap-1.5">
      <div className="flex-1">
        <FieldRow
          label={key}
          value={value}
          isEditing={editingField === `custom:${key}`}
          multiline={value.length > 60}
          onStartEdit={() => setEditingField(`custom:${key}`)}
          onCommit={(v) => {
            updateCustomField(key, v);
            setEditingField(null);
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => removeCustomField(key)}
        title="Remove this field"
        className="mt-5 shrink-0 text-zinc-300 hover:text-red-400 transition-colors text-xs leading-none px-1"
      >
        ✕
      </button>
    </div>
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <div
        className={`px-4 py-3 flex items-center justify-between border-b border-zinc-100 ${
          hasName ? "bg-emerald-50" : "bg-amber-50"
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${
              hasName ? "text-emerald-800" : "text-amber-800"
            }`}
          >
            {hasName ? "✓ Review before saving" : "⚠ Review — name not found"}
          </span>
          {!hasName && (
            <span className="text-xs text-amber-600">tap Name to add it</span>
          )}
        </div>
        <span className="text-xs text-zinc-400">tap any field to edit</span>
      </div>

      <div className="p-4 space-y-3">
        <FieldRow
          label="Name *"
          value={extracted.name ?? ""}
          isRequired
          isEditing={editingField === "name"}
          onStartEdit={() => setEditingField("name")}
          onCommit={(v) => {
            updateStandardField("name", v);
            setEditingField(null);
          }}
        />

        {filledStandard.map((f) => (
          <FieldRow
            key={f.key}
            label={f.label}
            value={(extracted[f.key] as string) ?? ""}
            isEditing={editingField === f.key}
            multiline={f.multiline}
            isTags={f.isTags}
            placeholder={f.placeholder}
            fromWeb={enrichedContact.includes(f.key)}
            onStartEdit={() => setEditingField(f.key)}
            onCommit={(v) => {
              updateStandardField(f.key, v);
              setEditingField(null);
            }}
          />
        ))}

        {showMissing &&
          missingStandard.map((f) => (
            <FieldRow
              key={f.key}
              label={f.label}
              value=""
              isEditing={editingField === f.key}
              multiline={f.multiline}
              isTags={f.isTags}
              placeholder={f.placeholder}
              onStartEdit={() => setEditingField(f.key)}
              onCommit={(v) => {
                updateStandardField(f.key, v);
                setEditingField(null);
              }}
            />
          ))}

        {missingStandard.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMissing((s) => !s)}
            className="text-xs text-indigo-600 hover:underline"
          >
            {showMissing
              ? "− Hide empty fields"
              : `+ Add missing fields (${missingStandard.length})`}
          </button>
        )}

        {detectedEntries.length > 0 && (
          <div className="pt-3 border-t border-zinc-100 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400">
              ✦ AI-detected
            </p>
            {detectedEntries.map(renderCustomRow)}
          </div>
        )}

        {enrichedEntries.length > 0 && (
          <div className="pt-3 border-t border-amber-100 space-y-3 -mx-4 -mb-4 mt-3 rounded-b-xl bg-amber-50/60 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                🌐 Enriched from public knowledge
              </p>
              <p className="mt-0.5 text-[11px] text-amber-700/80">
                Pulled from the public web — may be outdated or wrong. Verify
                before saving; remove any you don't want.
              </p>
            </div>
            {enrichedEntries.map(renderCustomRow)}

            {sources.length > 0 && (
              <div className="pt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600/80">
                  Sources
                </p>
                <ul className="mt-1 space-y-0.5">
                  {sources.map((s) => (
                    <li key={s.url} className="truncate text-[11px]">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-700 underline hover:text-amber-900"
                      >
                        {s.title || s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between gap-4">
        <p className="text-xs text-zinc-500">
          {hasName
            ? `${totalFields} field${totalFields !== 1 ? "s" : ""} ready to save`
            : "Add a name above to save this contact"}
        </p>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !extracted.name?.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save contact"}
        </button>
      </div>
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
  placeholder,
  fromWeb,
  onStartEdit,
  onCommit,
}: {
  label: string;
  value: string;
  isRequired?: boolean;
  isEditing: boolean;
  multiline?: boolean;
  isTags?: boolean;
  placeholder?: string;
  fromWeb?: boolean;
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
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
        {fromWeb && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
            🌐 web · verify
          </span>
        )}
      </dt>
      {isEditing ? (
        multiline ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (!escapedRef.current) onCommit(draft);
              escapedRef.current = false;
            }}
            onKeyDown={handleKeyDown}
            rows={2}
            className="input mt-1 w-full resize-y"
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (!escapedRef.current) onCommit(draft);
              escapedRef.current = false;
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
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
