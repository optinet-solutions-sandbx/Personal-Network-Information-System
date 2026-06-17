"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContactInput } from "@/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

export default function HomePageClient() {
  const router = useRouter();
  const [extracted, setExtracted] = useState<ContactInput | null>(null);
  const [enrichedKeys, setEnrichedKeys] = useState<string[]>([]);
  const [enrichedContact, setEnrichedContact] = useState<string[]>([]);
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  const [enrich, setEnrich] = useState(true);
  const [saving, setSaving] = useState(false);
  const [story, setStory] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
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
        setExtractError("Couldn't extract details — try rephrasing or extracting again.");
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
      const safe: ContactInput = {
        name: String(fields.name ?? ""),
        title: fields.title ? String(fields.title) : undefined,
        company: fields.company ? String(fields.company) : undefined,
        email: fields.email ? String(fields.email) : undefined,
        phone: fields.phone ? String(fields.phone) : undefined,
        location: fields.location ? String(fields.location) : undefined,
        tags: fields.tags ? String(fields.tags) : undefined,
        howWeMet: fields.howWeMet ? String(fields.howWeMet) : undefined,
        customFields:
          fields.customFields && Object.keys(fields.customFields).length > 0
            ? fields.customFields
            : undefined,
      };
      setExtracted(safe);
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
    setEnrichedKeys([]);
    setEnrichedContact([]);
    setSources([]);
    setExtractError(null);
  }

  async function handleSave() {
    if (!extracted?.name?.trim()) return;
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
        router.push(`/contacts/${contact.id}`);
      }
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

        {extracted && (
          <ReviewCard
            extracted={extracted}
            enrichedKeys={enrichedKeys}
            enrichedContact={enrichedContact}
            sources={sources}
            onUpdate={setExtracted}
            onSave={handleSave}
            saving={saving}
          />
        )}
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
}[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "tags", label: "Tags", isTags: true },
  { key: "howWeMet", label: "How we met", multiline: true },
];

function ReviewCard({
  extracted,
  enrichedKeys = [],
  enrichedContact = [],
  sources = [],
  onUpdate,
  onSave,
  saving,
}: {
  extracted: ContactInput;
  enrichedKeys?: string[];
  enrichedContact?: string[];
  sources?: { title: string; url: string }[];
  onUpdate: (updated: ContactInput) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

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
