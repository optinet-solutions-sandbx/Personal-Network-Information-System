# Relationship Health Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute, store, and display a 0–100 relationship health score per contact based on recency, frequency of notes, and profile richness.

**Architecture:** A pure calculation function in `lib/health.ts` takes a Prisma Contact + notes and returns a score/tier/inputs object. A server-side `recalculateHealth(contactId)` helper calls it and persists results. Every mutation API route calls this helper after writing. UI surfaces the score on both the contact detail page and the dashboard contact cards.

**Tech Stack:** Next.js App Router, Prisma ORM (PostgreSQL), Tailwind CSS, TypeScript.

## Global Constraints

- All Prisma imports use `import { prisma } from "@/lib/prisma"` — not a default import
- Route params follow `{ params: Promise<{ id: string }> }` with `await params` — not `context.params`
- No authentication guard needed (no auth system exists yet)
- No test framework in the project — verification is manual via the dev server
- `customFields` stored as JSON string in DB, parsed to `Record<string,string>` in API responses
- Follow existing code style: no inline comments unless non-obvious, no trailing summaries

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `healthScore`, `healthTier`, `healthInputs` to Contact |
| `lib/types.ts` | Modify | Add `HealthInputs` type; extend `Contact` with health fields |
| `lib/health.ts` | Create | Pure `calculateHealthScore` fn + `recalculateHealth` server helper |
| `app/api/contacts/route.ts` | Modify | Call `recalculateHealth` after POST (create) |
| `app/api/contacts/[id]/route.ts` | Modify | Call `recalculateHealth` after PATCH (update) |
| `app/api/contacts/[id]/notes/route.ts` | Modify | Call `recalculateHealth` after POST (add note) |
| `app/api/notes/[id]/route.ts` | Modify | Call `recalculateHealth` after PATCH and DELETE |
| `app/api/contacts/[id]/profile/route.ts` | Modify | Call `recalculateHealth` after POST (generate profile) |
| `app/api/contacts/recalculate-all-health/route.ts` | Create | One-time backfill: score all existing contacts |
| `app/contacts/[id]/HealthCard.tsx` | Create | Score display component: score, tier badge, sub-score bars |
| `app/contacts/[id]/page.tsx` | Modify | Render `<HealthCard>` between details and notes sections |
| `app/HomePageClient.tsx` | Modify | Add colored dot + tier + score to each contact card |

---

## Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: three new nullable columns on `Contact` — used by Tasks 2, 3, 7, 8

- [ ] **Step 1: Add health fields to the Contact model**

Open `prisma/schema.prisma`. Add these three lines inside the `Contact` model, after the `profileUpdatedAt` line:

```prisma
  // Relationship health score
  healthScore   Int?
  healthTier    String?
  healthInputs  String?   // JSON: { recency, frequency, richness, lastNoteAt, noteCount90d, filledFields }
```

The block should now read:

```prisma
  // AI-assisted profile
  profile          String?
  profileModel     String?
  profileUpdatedAt DateTime?

  // Relationship health score
  healthScore   Int?
  healthTier    String?
  healthInputs  String?

  notes Note[]
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add_health_score
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected output: `✔ Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add healthScore, healthTier, healthInputs to Contact schema"
```

---

## Task 2: Types

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `HealthInputs` type (used by Task 3, Task 6); optional health fields on `Contact` (used by Tasks 7, 8)

- [ ] **Step 1: Add `HealthInputs` type and extend `Contact`**

Open `lib/types.ts`. Add the `HealthInputs` type after the existing imports, and add three optional fields to `Contact`:

```typescript
// Client-facing shapes. Dates are serialized to ISO strings over the wire.

export type NoteSource = "manual" | "voice" | "story";

export type Note = {
  id: string;
  contactId: string;
  content: string;
  source: NoteSource;
  createdAt: string;
  updatedAt: string;
};

export type HealthInputs = {
  recency: number;
  frequency: number;
  richness: number;
  lastNoteAt: string | null;
  noteCount90d: number;
  filledFields: number;
};

export type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  location: string | null;
  tags: string | null;
  howWeMet: string | null;
  birthday: string | null;
  customFields: Record<string, string> | null;
  profile: string | null;
  profileModel: string | null;
  profileUpdatedAt: string | null;
  healthScore: number | null;
  healthTier: string | null;
  healthInputs: HealthInputs | null;
  createdAt: string;
  updatedAt: string;
  notes?: Note[];
  _count?: { notes: number };
};

export type ContactInput = {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  location?: string;
  tags?: string;
  howWeMet?: string;
  birthday?: string;
  customFields?: Record<string, string>;
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add HealthInputs type and health fields to Contact type"
```

---

## Task 3: Health Calculation Library

**Files:**
- Create: `lib/health.ts`

**Interfaces:**
- Consumes: Prisma `Contact` with `notes: Note[]` (Prisma types, NOT lib/types.ts — these have `Date` objects not strings)
- Produces:
  - `calculateHealthScore(contact: ContactWithNotes): HealthResult` — pure, no DB access
  - `recalculateHealth(contactId: string): Promise<void>` — fetches from DB, computes, persists

- [ ] **Step 1: Create `lib/health.ts`**

```typescript
import { Contact, Note } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type ContactWithNotes = Contact & { notes: Note[] };

type HealthResult = {
  score: number;
  tier: string;
  inputs: {
    recency: number;
    frequency: number;
    richness: number;
    lastNoteAt: string | null;
    noteCount90d: number;
    filledFields: number;
  };
};

function computeRecency(notes: Note[]): { score: number; lastNoteAt: string | null } {
  if (notes.length === 0) return { score: 0, lastNoteAt: null };

  const latest = notes.reduce((a, b) =>
    a.createdAt > b.createdAt ? a : b
  );
  const lastNoteAt = latest.createdAt.toISOString();
  const daysSince =
    (Date.now() - latest.createdAt.getTime()) / (1000 * 60 * 60 * 24);

  let score: number;
  if (daysSince <= 7) score = 40;
  else if (daysSince <= 30) score = 30;
  else if (daysSince <= 90) score = 20;
  else if (daysSince <= 180) score = 10;
  else score = 0;

  return { score, lastNoteAt };
}

function computeFrequency(notes: Note[]): { score: number; noteCount90d: number } {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const noteCount90d = notes.filter((n) => n.createdAt >= cutoff).length;

  let score: number;
  if (noteCount90d >= 10) score = 30;
  else if (noteCount90d >= 5) score = 22;
  else if (noteCount90d >= 2) score = 15;
  else if (noteCount90d >= 1) score = 8;
  else score = 0;

  return { score, noteCount90d };
}

function computeRichness(contact: Contact): { score: number; filledFields: number } {
  const stringFields = [
    "email",
    "phone",
    "company",
    "title",
    "location",
    "tags",
    "howWeMet",
    "birthday",
    "profile",
  ] as const;

  let filledFields = 0;
  for (const field of stringFields) {
    const val = contact[field];
    if (val && val.trim().length > 0) filledFields++;
  }

  if (contact.customFields) {
    try {
      const parsed = JSON.parse(contact.customFields);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        filledFields++;
      }
    } catch {
      // malformed JSON — don't count
    }
  }

  return { score: filledFields * 3, filledFields };
}

function tierFromScore(score: number): string {
  if (score >= 75) return "Strong";
  if (score >= 50) return "Active";
  if (score >= 25) return "Fading";
  return "Dormant";
}

export function calculateHealthScore(contact: ContactWithNotes): HealthResult {
  const { score: recency, lastNoteAt } = computeRecency(contact.notes);
  const { score: frequency, noteCount90d } = computeFrequency(contact.notes);
  const { score: richness, filledFields } = computeRichness(contact);

  const score = recency + frequency + richness;

  return {
    score,
    tier: tierFromScore(score),
    inputs: { recency, frequency, richness, lastNoteAt, noteCount90d, filledFields },
  };
}

export async function recalculateHealth(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { notes: true },
  });
  if (!contact) return;

  const { score, tier, inputs } = calculateHealthScore(contact);

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      healthScore: score,
      healthTier: tier,
      healthInputs: JSON.stringify(inputs),
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/health.ts
git commit -m "feat: add calculateHealthScore and recalculateHealth to lib/health"
```

---

## Task 4: Wire Recalculation into Mutation Routes

**Files:**
- Modify: `app/api/contacts/route.ts` (POST)
- Modify: `app/api/contacts/[id]/route.ts` (PATCH)
- Modify: `app/api/contacts/[id]/notes/route.ts` (POST)
- Modify: `app/api/notes/[id]/route.ts` (PATCH, DELETE)
- Modify: `app/api/contacts/[id]/profile/route.ts` (POST)

**Interfaces:**
- Consumes: `recalculateHealth` from `@/lib/health` (Task 3)

- [ ] **Step 1: Update `app/api/contacts/route.ts` POST handler**

Add the import at the top (after existing imports):

```typescript
import { recalculateHealth } from "@/lib/health";
```

In the `POST` handler, after `prisma.contact.create(...)` succeeds and before `return NextResponse.json(...)`, add:

```typescript
  await recalculateHealth(contact.id);
```

The end of the POST handler should look like:

```typescript
  const contact = await prisma.contact.create({
    data: {
      name: body.name.trim(),
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      company: body.company?.trim() || null,
      title: body.title?.trim() || null,
      location: body.location?.trim() || null,
      tags: body.tags?.trim() || null,
      howWeMet: body.howWeMet?.trim() || null,
      birthday: body.birthday?.trim() || null,
      customFields:
        body.customFields &&
        typeof body.customFields === "object" &&
        Object.keys(body.customFields).length > 0
          ? JSON.stringify(body.customFields)
          : null,
    },
  });

  await recalculateHealth(contact.id);

  return NextResponse.json(
    parseCustomFields(contact as unknown as Record<string, unknown>),
    { status: 201 }
  );
```

- [ ] **Step 2: Update `app/api/contacts/[id]/route.ts` PATCH handler**

Add the import at the top:

```typescript
import { recalculateHealth } from "@/lib/health";
```

In the `PATCH` handler, inside the `try` block, after `prisma.contact.update(...)` and before `return NextResponse.json(...)`:

```typescript
  try {
    const contact = await prisma.contact.update({ where: { id }, data });
    await recalculateHealth(id);
    return NextResponse.json(
      parseCustomFields(contact as unknown as Record<string, unknown>)
    );
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
```

- [ ] **Step 3: Update `app/api/contacts/[id]/notes/route.ts` POST handler**

Add the import at the top:

```typescript
import { recalculateHealth } from "@/lib/health";
```

In the `POST` handler, after both `prisma.note.create` and `prisma.contact.update` complete, add `recalculateHealth`. The end of the handler becomes:

```typescript
  const note = await prisma.note.create({
    data: { contactId: id, content: body.content.trim(), source },
  });
  await prisma.contact.update({ where: { id }, data: { updatedAt: new Date() } });
  await recalculateHealth(id);

  return NextResponse.json(note, { status: 201 });
```

- [ ] **Step 4: Update `app/api/notes/[id]/route.ts`**

This route does not receive the contactId — we must look it up first. Replace the entire file with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/notes/:id
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  try {
    const note = await prisma.note.update({
      where: { id },
      data: { content: body.content.trim() },
    });
    await recalculateHealth(note.contactId);
    return NextResponse.json(note);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

// DELETE /api/notes/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const note = await prisma.note.findUnique({
      where: { id },
      select: { contactId: true },
    });
    await prisma.note.delete({ where: { id } });
    if (note) await recalculateHealth(note.contactId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 5: Update `app/api/contacts/[id]/profile/route.ts`**

Add the import at the top (after existing imports):

```typescript
import { recalculateHealth } from "@/lib/health";
```

The end of the route currently reads:

```typescript
  const updated = await prisma.contact.update({
    where: { id },
    data: { profile, profileModel: model, profileUpdatedAt: new Date() },
  });

  return NextResponse.json(updated);
```

Change it to:

```typescript
  const updated = await prisma.contact.update({
    where: { id },
    data: { profile, profileModel: model, profileUpdatedAt: new Date() },
  });

  await recalculateHealth(id);

  return NextResponse.json(updated);
```

- [ ] **Step 6: Commit**

```bash
git add app/api/contacts/route.ts \
        app/api/contacts/[id]/route.ts \
        app/api/contacts/[id]/notes/route.ts \
        app/api/notes/[id]/route.ts \
        app/api/contacts/[id]/profile/route.ts
git commit -m "feat: recalculate health score on every contact/note mutation"
```

---

## Task 5: Backfill Endpoint

**Files:**
- Create: `app/api/contacts/recalculate-all-health/route.ts`

**Interfaces:**
- Consumes: `recalculateHealth` from `@/lib/health` (Task 3)
- Produces: `POST /api/contacts/recalculate-all-health` → `{ updated: number }`

- [ ] **Step 1: Create the backfill route**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";

// POST /api/contacts/recalculate-all-health
// One-time backfill to populate health scores for all existing contacts.
export async function POST() {
  const contacts = await prisma.contact.findMany({ select: { id: true } });

  for (const { id } of contacts) {
    await recalculateHealth(id);
  }

  return NextResponse.json({ updated: contacts.length });
}
```

- [ ] **Step 2: Call the backfill endpoint once after deploying**

From a terminal (or REST client):

```bash
curl -X POST http://localhost:3000/api/contacts/recalculate-all-health
```

Expected response: `{"updated": N}` where N is the number of contacts in the database.

- [ ] **Step 3: Commit**

```bash
git add app/api/contacts/recalculate-all-health/route.ts
git commit -m "feat: add backfill endpoint for bulk health score recalculation"
```

---

## Task 6: HealthCard Component

**Files:**
- Create: `app/contacts/[id]/HealthCard.tsx`

**Interfaces:**
- Consumes: `HealthInputs` from `@/lib/types` (Task 2)
- Produces: `<HealthCard score tier inputs />` — used by Task 7

- [ ] **Step 1: Create `app/contacts/[id]/HealthCard.tsx`**

```typescript
"use client";

import type { HealthInputs } from "@/lib/types";

type Props = {
  score: number;
  tier: string;
  inputs: HealthInputs;
};

const TIER_BADGE: Record<string, string> = {
  Strong: "text-green-700 bg-green-50 border-green-200",
  Active: "text-blue-700 bg-blue-50 border-blue-200",
  Fading: "text-amber-700 bg-amber-50 border-amber-200",
  Dormant: "text-gray-500 bg-gray-50 border-gray-200",
};

const TIER_DOT: Record<string, string> = {
  Strong: "bg-green-500",
  Active: "bg-blue-500",
  Fading: "bg-amber-500",
  Dormant: "bg-gray-400",
};

const TIER_BAR: Record<string, string> = {
  Strong: "bg-green-400",
  Active: "bg-blue-400",
  Fading: "bg-amber-400",
  Dormant: "bg-gray-400",
};

function SubScore({
  label,
  value,
  max,
  barColor,
}: {
  label: string;
  value: number;
  max: number;
  barColor: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span className="font-medium">
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function HealthCard({ score, tier, inputs }: Props) {
  const badgeClass = TIER_BADGE[tier] ?? TIER_BADGE.Dormant;
  const dotClass = TIER_DOT[tier] ?? TIER_DOT.Dormant;
  const barClass = TIER_BAR[tier] ?? TIER_BAR.Dormant;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Relationship Health
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}
        >
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          {tier}
        </span>
      </div>
      <p className="mb-4 text-4xl font-bold text-gray-800">
        {score}
        <span className="text-base font-normal text-gray-400">/100</span>
      </p>
      <div className="space-y-3">
        <SubScore label="Recency" value={inputs.recency} max={40} barColor={barClass} />
        <SubScore label="Frequency (90d)" value={inputs.frequency} max={30} barColor={barClass} />
        <SubScore label="Profile richness" value={inputs.richness} max={30} barColor={barClass} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/contacts/[id]/HealthCard.tsx
git commit -m "feat: add HealthCard component for contact detail page"
```

---

## Task 7: Wire HealthCard into Contact Detail Page

**Files:**
- Modify: `app/contacts/[id]/page.tsx`

**Interfaces:**
- Consumes: `HealthCard` from `./HealthCard` (Task 6); `HealthInputs` from `@/lib/types` (Task 2)
- Consumes: Contact data from `GET /api/contacts/:id` — the `healthInputs` field arrives as a raw JSON string (the `parseCustomFields` utility in that route only parses `customFields`), so it must be parsed client-side

- [ ] **Step 1: Add imports**

In `app/contacts/[id]/page.tsx`, add these two imports after the existing import block (after line 10):

```typescript
import HealthCard from "./HealthCard";
import type { HealthInputs } from "@/lib/types";
```

- [ ] **Step 2: Parse `healthInputs` in the `load` callback**

The `load` function (lines 23–32) currently does `setContact(await res.json())`. `healthInputs` will be a JSON string in that response. Update `load` to parse it:

```typescript
  const load = useCallback(async () => {
    const res = await fetch(`/api/contacts/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    if (typeof data.healthInputs === "string") {
      try {
        data.healthInputs = JSON.parse(data.healthInputs) as HealthInputs;
      } catch {
        data.healthInputs = null;
      }
    }
    setContact(data);
    setLoading(false);
  }, [id]);
```

- [ ] **Step 3: Render HealthCard between DetailsCard and NotesSection**

The main return JSX (lines 66–79) currently renders `<DetailsCard>` then `<NotesSection>` inside the `lg:col-span-3` div. Insert `<HealthCard>` between them:

```tsx
      <DetailsCard contact={contact} onSaved={load} onDelete={handleDelete} />
      {contact.healthScore != null &&
        contact.healthTier != null &&
        contact.healthInputs != null && (
          <div className="mt-6">
            <HealthCard
              score={contact.healthScore}
              tier={contact.healthTier}
              inputs={contact.healthInputs as HealthInputs}
            />
          </div>
        )}
      <NotesSection contact={contact} onChange={load} />
```

- [ ] **Step 4: Verify manually**

Start the dev server (`npm run dev`). After running the backfill (Task 5 Step 2), open any contact. Confirm `HealthCard` appears between the details card and the notes section, showing a numeric score, tier badge, and three sub-score bars.

- [ ] **Step 5: Commit**

```bash
git add app/contacts/[id]/page.tsx
git commit -m "feat: render HealthCard on contact detail page"
```

---

## Task 8: Dashboard Health Indicator

**Files:**
- Modify: `app/HomePageClient.tsx`

**Interfaces:**
- Consumes: `healthScore`, `healthTier` on each `Contact` returned by `GET /api/contacts` (now included automatically)

- [ ] **Step 1: Add tier-to-color mapping near the top of the component**

Find the top of the component function in `app/HomePageClient.tsx` (or a constants section near it). Add:

```typescript
const TIER_DOT: Record<string, string> = {
  Strong: "bg-green-500",
  Active: "bg-blue-500",
  Fading: "bg-amber-500",
  Dormant: "bg-gray-400",
};
```

- [ ] **Step 2: Add health indicator to each contact card**

Find the JSX that renders each contact card (the element that shows name, title/company, tags). Locate where the note count badge or profile badge is rendered. Just below or after that, add:

```tsx
{contact.healthScore != null && contact.healthTier && (
  <span className="flex items-center gap-1 text-xs text-gray-500">
    <span
      className={`inline-block h-2 w-2 rounded-full ${TIER_DOT[contact.healthTier] ?? "bg-gray-400"}`}
    />
    <span className="font-medium">{contact.healthTier}</span>
    <span className="text-gray-400">({contact.healthScore})</span>
  </span>
)}
```

- [ ] **Step 3: Verify manually**

With the dev server running, open the dashboard. Each contact card should show a colored dot, tier label, and score. New contacts with no notes will show `Dormant (score)` until notes are added.

- [ ] **Step 4: Commit**

```bash
git add app/HomePageClient.tsx
git commit -m "feat: show health score indicator on dashboard contact cards"
```

---

## Post-Implementation Checklist

- [ ] Run `curl -X POST http://localhost:3000/api/contacts/recalculate-all-health` to backfill existing contacts
- [ ] Open a contact with several recent notes — confirm `Strong` or `Active` with score > 50
- [ ] Open a contact with no notes and few fields — confirm `Dormant` with score < 25
- [ ] Add a note to a contact — reload the detail page and confirm the score increased (recency/frequency updated)
- [ ] Edit a contact's fields (add email, phone) — confirm richness sub-score increases
- [ ] Delete a note — confirm score drops accordingly
- [ ] Confirm dashboard cards all show health indicators
