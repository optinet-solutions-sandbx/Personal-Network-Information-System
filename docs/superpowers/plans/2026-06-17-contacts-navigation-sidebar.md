# Contacts Navigation Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `ContactsSidebar` into the app shell and trim the home page down to a focused Add Contact form.

**Architecture:** Add the sidebar to `app/layout.tsx` in a full-height flex row beside the main content area. Strip the redundant contact list and search from `HomePageClient.tsx`, leaving only the story extraction and save flow. After saving a contact, navigate to the new contact's detail page so the sidebar refreshes automatically.

**Tech Stack:** Next.js App Router, React 19, Tailwind CSS 4, TypeScript

## Global Constraints

- No new components — wire existing `ContactsSidebar` only
- No changes to `components/ContactsSidebar.tsx`
- No changes to any API routes
- Tailwind utility classes only (no inline styles)
- `"use client"` is already on `ContactsSidebar` — import it freely from the server-side layout

---

### Task 1: Add ContactsSidebar to the app shell

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `components/ContactsSidebar` (default export, no props)
- Produces: persistent sidebar visible on every page

- [ ] **Step 1: Open `app/layout.tsx` and replace its content**

Replace the entire file with:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import ContactsSidebar from "@/components/ContactsSidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Networky.ai — Relationship Intelligence",
  description:
    "Capture, organize, and enrich professional relationships with AI-assisted profiles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="flex items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                N
              </span>
              <span className="text-lg font-semibold tracking-tight">
                Networky<span className="text-indigo-600">.ai</span>
              </span>
            </Link>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500">
              Phase 1 · MVP
            </span>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <ContactsSidebar />
          <main className="flex-1 overflow-y-auto px-6 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
```

Key changes from the original:
- `body` gets `h-full` (was `min-h-full`) so the flex children fill the viewport
- Header `div` drops `mx-auto max-w-5xl` — goes full width
- New `<div className="flex flex-1 overflow-hidden">` wraps sidebar + main
- `<main>` drops `mx-auto w-full max-w-5xl` and gains `flex-1 overflow-y-auto`

- [ ] **Step 2: Verify the dev server compiles without errors**

Run: `npm run dev`

Expected: server starts, no TypeScript or import errors in the terminal.

- [ ] **Step 3: Visual check in browser**

Open `http://localhost:3000`. Expected:
- Sidebar appears on the left, ~224px wide, with the "Contacts" header and "+ Add" button
- Main content fills the remaining width
- Header spans full width above both
- Navigating to any `/contacts/[id]` page shows the sidebar with that contact highlighted in blue

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: add ContactsSidebar to app shell layout"
```

---

### Task 2: Strip the contact list from HomePageClient

**Files:**
- Modify: `app/HomePageClient.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: slimmed-down add-contact form; navigates to `/contacts/:id` after save

- [ ] **Step 1: Replace `app/HomePageClient.tsx` with the stripped version**

Replace the entire file content with the following. The `ReviewCard` and `FieldRow` components at the bottom are **unchanged** — copy them exactly as they are now.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContactInput } from "@/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

export default function HomePageClient() {
  const router = useRouter();
  const [extracted, setExtracted] = useState<ContactInput | null>(null);
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
        body: JSON.stringify({ text: story }),
      });
      if (!res.ok) {
        setExtractError("Couldn't extract details — try rephrasing or extracting again.");
        return;
      }
      const { fields } = (await res.json()) as { fields: ContactInput };
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
      setExtractError(null);
    } finally {
      setExtracting(false);
    }
  }

  function resetForm() {
    setStory("");
    setExtracted(null);
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

        {extractError && (
          <p className="text-xs text-red-600">{extractError}</p>
        )}

        {extracted && (
          <ReviewCard
            extracted={extracted}
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
  onUpdate,
  onSave,
  saving,
}: {
  extracted: ContactInput;
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
  const totalFields = 1 + filledStandard.length + customEntries.length;

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

        {customEntries.length > 0 && (
          <div className="pt-3 border-t border-zinc-100 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400">
              ✦ AI-detected
            </p>
            {customEntries.map(([key, value]) => (
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
            ))}
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
```

What changed vs the original:
- Removed imports: `useCallback`, `Link`, `Contact` type
- Added import: `useRouter` from `"next/navigation"`
- Removed state: `contacts`, `query`, `loading`, `debounce`
- Removed functions: `load`, the `useEffect` for debounced search
- Removed from `handleSave`: `resetForm()`, `setShowForm(false)`, `setQuery("")`; replaced with `router.push(\`/contacts/${contact.id}\`)`
- Removed from JSX: toggle button for show/hide form, search input, contact list grid, loading/empty states
- Updated heading from "Contacts" to "Add Contact"
- Form is always visible (no `showForm` toggle)

- [ ] **Step 2: Verify the dev server compiles without TypeScript errors**

Check the terminal running `npm run dev` — no red errors expected.

- [ ] **Step 3: Visual check — home page**

Open `http://localhost:3000`. Expected:
- Page shows "Add Contact" heading with the story extraction form open by default
- No search bar, no contact grid
- Sidebar on the left still lists all contacts

- [ ] **Step 4: Visual check — save flow**

Type a short story into the textarea (e.g. "Met John Smith, CTO of Acme"), click Extract, review the card, click Save. Expected:
- Browser navigates to `/contacts/<new-id>`
- New contact appears in the sidebar (highlighted, since it's now the active page)

- [ ] **Step 5: Visual check — sidebar + Add button**

From any contact detail page, click "+ Add" in the sidebar. Expected: navigates to `/` (the add contact form).

- [ ] **Step 6: Commit**

```bash
git add app/HomePageClient.tsx
git commit -m "feat: make home page a focused add-contact form, navigate to contact after save"
```
