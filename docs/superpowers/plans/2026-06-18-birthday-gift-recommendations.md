# Birthday Gift Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a contact's birthday is within 30 days, show 3 AI-generated gift suggestions on the contact detail page; selecting one saves it as a note.

**Architecture:** `lib/gifts.ts` generates suggestions via OpenAI (mirrors `lib/profile.ts`); `app/api/contacts/[id]/gifts/route.ts` is a POST endpoint that fetches the contact + 5 recent notes then calls the lib; `app/contacts/[id]/GiftSuggestions.tsx` is a client component that auto-fetches on mount, renders suggestion cards, handles regenerate, and POSTs a note on selection. The section is conditionally rendered in the contact page's right column, below `ProfileCard`, only when `daysUntilBirthday` returns 0–30.

**Tech Stack:** Next.js App Router, React, TypeScript, OpenAI SDK (`openai`), Prisma, Tailwind CSS, SweetAlert2 (already installed)

## Global Constraints

- Follow the exact pattern of `lib/profile.ts` and `app/api/contacts/[id]/profile/route.ts` for any new lib/route files
- No new npm packages — `openai` is already installed
- Tailwind only for styling — no inline `style=` props
- No Prisma schema migration needed — `source` is a plain `String` field
- All API routes use `params: Promise<{ id: string }>` (Next.js 15 async params pattern already used in codebase)
- No auth gating — consistent with rest of codebase

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `lib/types.ts` | Add `GiftSuggestion` type; add `"gift"` to `NoteSource` |
| Modify | `app/api/contacts/[id]/notes/route.ts` | Accept `source: "gift"` in POST handler |
| Create | `lib/gifts.ts` | Build prompt, call OpenAI, deterministic fallback |
| Create | `app/api/contacts/[id]/gifts/route.ts` | POST endpoint — fetch contact + notes, return suggestions |
| Create | `app/contacts/[id]/GiftSuggestions.tsx` | Client component — fetch, display, regenerate, save as note |
| Modify | `app/contacts/[id]/page.tsx` | Import GiftSuggestions; compute daysUntil; conditionally render |

---

### Task 1: Extend types and update NoteSource handling

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/api/contacts/[id]/notes/route.ts`

**Interfaces:**
- Produces: `GiftSuggestion` type used by Tasks 3, 4; `NoteSource` now includes `"gift"` used by Task 4

- [ ] **Step 1: Add `GiftSuggestion` to `lib/types.ts` and extend `NoteSource`**

In `lib/types.ts`, make these two changes:

Change line 3 from:
```typescript
export type NoteSource = "manual" | "voice" | "story";
```
To:
```typescript
export type NoteSource = "manual" | "voice" | "story" | "gift";
```

Add after the `NoteSource` line (line 3):
```typescript
export type GiftSuggestion = { title: string; rationale: string };
```

- [ ] **Step 2: Update notes route to handle `source: "gift"`**

In `app/api/contacts/[id]/notes/route.ts`, replace the source assignment (currently lines 31–33):
```typescript
const source: NoteSource =
  body.source === "voice" ? "voice" : body.source === "story" ? "story" : "manual";
```
With:
```typescript
const source: NoteSource =
  body.source === "voice"
    ? "voice"
    : body.source === "story"
    ? "story"
    : body.source === "gift"
    ? "gift"
    : "manual";
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit`
Expected: No errors related to `NoteSource` or `GiftSuggestion`

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts app/api/contacts/[id]/notes/route.ts
git commit -m "feat: add GiftSuggestion type and gift note source"
```

---

### Task 2: Create `lib/gifts.ts`

**Files:**
- Create: `lib/gifts.ts`

**Interfaces:**
- Consumes: `GiftSuggestion` from `lib/types.ts` (Task 1)
- Produces: `generateGiftSuggestions(input: GiftsInput): Promise<GiftSuggestion[]>` — used by Task 3

- [ ] **Step 1: Create `lib/gifts.ts`**

```typescript
import OpenAI from "openai";
import type { GiftSuggestion } from "@/lib/types";

export type GiftsInput = {
  name: string;
  title?: string | null;
  company?: string | null;
  howWeMet?: string | null;
  customFields?: Record<string, string> | null;
  recentNotes: string[];
};

const SYSTEM_PROMPT = `You are a thoughtful gift advisor helping someone choose a birthday gift for a contact.
Given the contact's profile details and recent notes, suggest exactly 3 personalized gift ideas.
Return ONLY a JSON object in this exact shape, no markdown fences:
{"suggestions":[{"title":"...","rationale":"..."},{"title":"...","rationale":"..."},{"title":"...","rationale":"..."}]}
Each rationale must be 1-2 sentences tying the gift directly to something specific you know about the person.
Be specific. Do not invent facts not present in the input.`;

function buildUserMessage(input: GiftsInput): string {
  const fields = [
    ["Name", input.name],
    ["Title", input.title],
    ["Company", input.company],
    ["How we met", input.howWeMet],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const custom = input.customFields
    ? Object.entries(input.customFields)
        .filter(([, v]) => v)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")
    : "";

  const notes = input.recentNotes.length
    ? input.recentNotes.map((n, i) => `Note ${i + 1}: ${n}`).join("\n")
    : "(no notes yet)";

  return [
    "Contact details:",
    fields || "(none)",
    custom ? `\nAdditional info:\n${custom}` : "",
    `\nRecent notes:\n${notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallback(input: GiftsInput): GiftSuggestion[] {
  const interests = (
    input.customFields?.Interests ||
    input.customFields?.Hobbies ||
    ""
  ).toLowerCase();

  const profession = [input.title, input.company].filter(Boolean).join(" at ") || "professional";
  const suggestions: GiftSuggestion[] = [];

  if (interests.includes("coffee")) {
    suggestions.push({
      title: "Specialty Coffee Subscription",
      rationale: `${input.name} is interested in coffee — a curated single-origin subscription makes a personal and practical gift.`,
    });
  }

  if (interests.includes("book") || interests.includes("read")) {
    suggestions.push({
      title: "Curated Book in Their Field",
      rationale: `${input.name} enjoys reading — a well-chosen book aligned with their work or interests shows thoughtfulness.`,
    });
  }

  if (interests.includes("tech") || interests.includes("software") || interests.includes("code")) {
    suggestions.push({
      title: "Mechanical Keyboard or Desk Accessory",
      rationale: `As someone in tech, ${input.name} would appreciate a quality desk upgrade for their workspace.`,
    });
  }

  const backfill: GiftSuggestion[] = [
    {
      title: "Premium Notebook & Pen Set",
      rationale: `A quality notebook is a thoughtful everyday gift for any ${profession}.`,
    },
    {
      title: "Streaming or Learning Platform Gift Card",
      rationale: `Gives ${input.name} the flexibility to pick content that fits their schedule and interests.`,
    },
    {
      title: "Artisan Food & Drink Gift Box",
      rationale: `A curated gourmet selection is a universally appreciated birthday gesture.`,
    },
  ];

  for (const g of backfill) {
    if (suggestions.length >= 3) break;
    suggestions.push(g);
  }

  return suggestions.slice(0, 3);
}

export async function generateGiftSuggestions(
  input: GiftsInput
): Promise<GiftSuggestion[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return buildFallback(input);

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return buildFallback(input);
    const parsed = JSON.parse(text) as { suggestions: GiftSuggestion[] };
    if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
      return buildFallback(input);
    }
    return parsed.suggestions.slice(0, 3);
  } catch (err) {
    console.error("OpenAI gift generation failed, using fallback:", err);
    return buildFallback(input);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors in `lib/gifts.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/gifts.ts
git commit -m "feat: add generateGiftSuggestions lib with OpenAI and fallback"
```

---

### Task 3: Create `app/api/contacts/[id]/gifts/route.ts`

**Files:**
- Create: `app/api/contacts/[id]/gifts/route.ts`

**Interfaces:**
- Consumes: `generateGiftSuggestions` from `lib/gifts.ts` (Task 2); Prisma contact + notes
- Produces: `POST /api/contacts/:id/gifts` → `{ suggestions: GiftSuggestion[] }`

- [ ] **Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateGiftSuggestions } from "@/lib/gifts";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { notes: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const customFields =
    contact.customFields != null
      ? typeof contact.customFields === "string"
        ? (JSON.parse(contact.customFields) as Record<string, string>)
        : (contact.customFields as Record<string, string>)
      : null;

  try {
    const suggestions = await generateGiftSuggestions({
      name: contact.name,
      title: contact.title,
      company: contact.company,
      howWeMet: contact.howWeMet,
      customFields,
      recentNotes: contact.notes.map((n) => n.content),
    });
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("Gift suggestions route failed:", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Smoke-test the endpoint manually**

Start the dev server (`npm run dev`), open a contact that exists, then in the browser console run:
```javascript
fetch('/api/contacts/REPLACE_WITH_A_REAL_CONTACT_ID/gifts', { method: 'POST' })
  .then(r => r.json()).then(console.log)
```
Expected: `{ suggestions: [ { title: "...", rationale: "..." }, ... ] }` with 3 items.

- [ ] **Step 4: Commit**

```bash
git add "app/api/contacts/[id]/gifts/route.ts"
git commit -m "feat: add POST /api/contacts/:id/gifts endpoint"
```

---

### Task 4: Create `app/contacts/[id]/GiftSuggestions.tsx`

**Files:**
- Create: `app/contacts/[id]/GiftSuggestions.tsx`

**Interfaces:**
- Consumes: `POST /api/contacts/:id/gifts` (Task 3); `POST /api/contacts/:id/notes` (existing); `GiftSuggestion` from `lib/types.ts` (Task 1)
- Produces: `<GiftSuggestions contactId={string} contactName={string} daysUntil={number} />` — used by Task 5

- [ ] **Step 1: Create the component**

```typescript
"use client";
import { useEffect, useState } from "react";
import type { GiftSuggestion } from "@/lib/types";

interface Props {
  contactId: string;
  contactName: string;
  daysUntil: number;
}

export default function GiftSuggestions({ contactId, contactName, daysUntil }: Props) {
  const [suggestions, setSuggestions] = useState<GiftSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  async function fetchSuggestions() {
    setLoading(true);
    setError(false);
    setSuggestions([]);
    setSaved(new Set());
    try {
      const res = await fetch(`/api/contacts/${contactId}/gifts`, { method: "POST" });
      if (!res.ok) throw new Error("non-ok response");
      const data = (await res.json()) as { suggestions: GiftSuggestion[] };
      setSuggestions(data.suggestions ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function handleSelect(index: number, suggestion: GiftSuggestion) {
    if (saved.has(index)) return;
    const content = `🎁 Gift idea: ${suggestion.title} — ${suggestion.rationale}`;
    await fetch(`/api/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source: "gift" }),
    });
    setSaved((prev) => new Set(prev).add(index));
  }

  const countdownLabel =
    daysUntil === 0
      ? `🎂 ${contactName}'s birthday is today! 🎉`
      : `🎂 ${contactName}'s birthday is in ${daysUntil} day${daysUntil === 1 ? "" : "s"}!`;

  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <p className="mb-4 font-medium text-amber-800">{countdownLabel}</p>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-zinc-800">
          🎁 Gift Suggestions
        </h2>
        <button
          onClick={fetchSuggestions}
          disabled={loading}
          className="text-xs text-indigo-600 hover:underline disabled:opacity-40"
        >
          ↻ Regenerate
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-amber-100" />
          ))}
        </div>
      )}

      {error && !loading && (
        <p className="text-sm text-red-500">
          Couldn&apos;t load suggestions.{" "}
          <button onClick={fetchSuggestions} className="underline">
            Try again
          </button>
        </p>
      )}

      {!loading && !error && suggestions.length > 0 && (
        <ul className="space-y-2">
          {suggestions.map((s, i) => {
            const isSaved = saved.has(i);
            return (
              <li key={i}>
                <button
                  onClick={() => handleSelect(i, s)}
                  disabled={isSaved}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    isSaved
                      ? "cursor-default border-green-200 bg-green-50"
                      : "border-amber-200 bg-white hover:border-amber-400 hover:bg-amber-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-800">{s.title}</span>
                    {isSaved && (
                      <span className="shrink-0 text-xs text-green-600">Saved as note ✓</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{s.rationale}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add "app/contacts/[id]/GiftSuggestions.tsx"
git commit -m "feat: add GiftSuggestions client component"
```

---

### Task 5: Wire GiftSuggestions into the contact page

**Files:**
- Modify: `app/contacts/[id]/page.tsx`

**Interfaces:**
- Consumes: `GiftSuggestions` component (Task 4); `daysUntilBirthday` from `lib/birthday.ts`; `contact.birthday` from existing Contact type

- [ ] **Step 1: Add imports to `app/contacts/[id]/page.tsx`**

Find the existing imports block (around lines 9–11):
```typescript
import { Markdown } from "@/components/Markdown";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import HealthCard from "./HealthCard";
```

Add two new import lines after the HealthCard import:
```typescript
import { daysUntilBirthday } from "@/lib/birthday";
import GiftSuggestions from "./GiftSuggestions";
```

- [ ] **Step 2: Compute `daysUntil` in the main page component**

In the `ContactDetailPage` component function body, just before the `return (` statement (around line 75), add:
```typescript
const daysUntil = contact.birthday ? daysUntilBirthday(contact.birthday) : null;
```

- [ ] **Step 3: Render GiftSuggestions in the right column**

Find the right-column div (around lines 96–98):
```tsx
<div className="lg:col-span-2">
  <ProfileCard contact={contact} onChange={load} />
</div>
```

Replace it with:
```tsx
<div className="lg:col-span-2">
  <ProfileCard contact={contact} onChange={load} />
  {contact.birthday && daysUntil !== null && daysUntil <= 30 && (
    <GiftSuggestions
      contactId={contact.id}
      contactName={contact.name}
      daysUntil={daysUntil}
    />
  )}
</div>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Manual end-to-end test**

1. Start the dev server: `npm run dev`
2. Open a contact that has a birthday set within the next 30 days (or temporarily set a contact's birthday to today's month/day, e.g. `06-18`)
3. Navigate to that contact's detail page
4. Verify: The amber gift card section appears below the profile section
5. Verify: 3 gift suggestions load (with skeleton animation while loading)
6. Verify: The birthday countdown label is correct ("today" or "in X days")
7. Click a suggestion → verify it highlights green and shows "Saved as note ✓"
8. Scroll to the Notes section → verify a new note appears starting with "🎁 Gift idea: ..."
9. Click **Regenerate** → verify loading skeletons appear then new suggestions load
10. Open a contact with no birthday set → verify the gift section does not appear
11. Open a contact with a birthday more than 30 days away → verify the gift section does not appear

- [ ] **Step 6: Commit**

```bash
git add "app/contacts/[id]/page.tsx"
git commit -m "feat: surface birthday gift recommendations on contact page"
```
