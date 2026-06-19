# Suggested Introductions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-powered "Suggested Introductions" dashboard section that uses Claude to find semantically compatible pairs in the user's network and persists accept/dismiss decisions so dismissed pairs never resurface.

**Architecture:** A keyword-bucket pre-filter narrows all contacts down to ≤30 candidate pairs (same or adjacent industry buckets), those pairs are sent to Claude Haiku in a single API call for semantic scoring and rationale generation, and results are upserted into a `Suggestion` Prisma model. The dashboard renders up to 5 pending suggestions with accept/dismiss actions. Dismissed and accepted pairs are excluded from future generation runs.

**Tech Stack:** Next.js 15 App Router, Prisma (PostgreSQL/Supabase), `@anthropic-ai/sdk`, TypeScript, Tailwind CSS.

## Global Constraints

- Model: `claude-haiku-4-5-20251001` (override via `ANTHROPIC_MODEL` env var)
- Auth pattern: use `resolveOwner()` + `ownerWhere()` from `@/lib/auth` on every route — identical to all existing API routes
- Pair normalization: always store `contactAId < contactBId` alphabetically so A↔B and B↔A are the same DB row
- No new pages — this is a dashboard section only
- Fallback: when `ANTHROPIC_API_KEY` is absent, return up to 5 rule-based suggestions with generic rationale (same pattern as all other AI features in this codebase)
- All API routes live under `app/api/suggestions/`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `prisma/schema.prisma` | Add `Suggestion` model + back-relations on `Contact` |
| Modify | `lib/types.ts` | Add `Suggestion` TypeScript type |
| Create | `lib/introductions.ts` | Bucket pre-filter + Claude API call + fallback |
| Create | `app/api/suggestions/route.ts` | `GET` (list pending) + `POST` (generate batch) |
| Create | `app/api/suggestions/[id]/route.ts` | `PATCH` (accept/dismiss) |
| Create | `components/SuggestedIntroductions.tsx` | Dashboard section component |
| Modify | `app/dashboard/page.tsx` | Import and render `SuggestedIntroductions` |

---

## Task 1: Install Anthropic SDK

**Files:**
- No file edits — package install only

- [ ] **Step 1: Install the SDK**

```bash
npm install @anthropic-ai/sdk
```

Expected output: package added to `node_modules` and `package.json` updated.

- [ ] **Step 2: Verify import resolves**

```bash
node -e "require('@anthropic-ai/sdk'); console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Add env var to .env.local (if it exists) or document it**

Open `.env.local` (or `.env`) and add:
```
ANTHROPIC_API_KEY=your_key_here
# Optional — defaults to claude-haiku-4-5-20251001
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

If neither file exists, create `.env.local` with the above two lines.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @anthropic-ai/sdk for introduction suggestions"
```

---

## Task 2: Prisma Schema — Add Suggestion Model

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Suggestion` Prisma model with compound unique `@@unique([contactAId, contactBId])` used as `contactAId_contactBId` in all upsert `where` clauses

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Add these two back-relation fields to the existing `Contact` model (after `notes Note[]`):

```prisma
  suggestionsAsA Suggestion[] @relation("SuggestionA")
  suggestionsAsB Suggestion[] @relation("SuggestionB")
```

Then append the full `Suggestion` model at the end of the file:

```prisma
model Suggestion {
  id         String   @id @default(cuid())
  userId     String?

  contactAId String
  contactBId String
  contactA   Contact  @relation("SuggestionA", fields: [contactAId], references: [id], onDelete: Cascade)
  contactB   Contact  @relation("SuggestionB", fields: [contactBId], references: [id], onDelete: Cascade)

  rationale  String
  score      Float
  status     String   @default("pending")

  generatedAt DateTime @default(now())
  respondedAt DateTime?

  @@unique([contactAId, contactBId])
  @@index([userId, status])
}
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add_suggestions
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected output: `Generated Prisma Client`

- [ ] **Step 4: Verify table exists**

```bash
npx prisma studio
```

Open the browser tab, confirm `Suggestion` table appears in the left sidebar. Close Studio (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Suggestion model for introduction suggestions"
```

---

## Task 3: Add Suggestion Type to lib/types.ts

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `Suggestion` type consumed by `components/SuggestedIntroductions.tsx` and `app/api/suggestions/route.ts`

- [ ] **Step 1: Append the `Suggestion` type to `lib/types.ts`**

Add at the end of the file:

```typescript
export type Suggestion = {
  id: string;
  userId: string | null;
  contactAId: string;
  contactBId: string;
  contactA: { id: string; name: string; title: string | null; company: string | null };
  contactB: { id: string; name: string; title: string | null; company: string | null };
  rationale: string;
  score: number;
  status: "pending" | "accepted" | "dismissed";
  generatedAt: string;
  respondedAt: string | null;
};
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected output: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add Suggestion type"
```

---

## Task 4: Create lib/introductions.ts

**Files:**
- Create: `lib/introductions.ts`

**Interfaces:**
- Consumes: `Contact` from `@/lib/types` (uses `id`, `name`, `title`, `company`, `tags`, `profile`)
- Produces: `generateIntroductionSuggestions(contacts: Contact[], respondedPairs: Set<string>): Promise<IntroductionCandidate[]>`
  - `IntroductionCandidate = { contactAId: string; contactBId: string; rationale: string; score: number }`
  - `respondedPairs` contains pair keys in `"smallerId:largerId"` format — these are skipped entirely

- [ ] **Step 1: Create `lib/introductions.ts`** with the full content below:

```typescript
import Anthropic from "@anthropic-ai/sdk"
import type { Contact } from "./types"

export type IntroductionCandidate = {
  contactAId: string
  contactBId: string
  rationale: string
  score: number
}

const BUCKETS: Record<string, string[]> = {
  tech: [
    "engineer", "developer", "software", "web", "data", "devops", "cto",
    "programmer", "cloud", "backend", "frontend", "fullstack", "mobile",
    "ios", "android", "ml", "ai", "tech",
  ],
  marketing: [
    "marketing", "brand", "content", "seo", "social", "growth",
    "campaign", "communications", "pr", "copywriter",
  ],
  design: [
    "designer", "ux", "ui", "creative", "art director", "product design", "visual",
  ],
  sales: [
    "sales", "account", "business development", "bdr", "sdr", "revenue", "partnerships",
  ],
  finance: [
    "finance", "accounting", "cfo", "investment", "banker", "analyst", "vc", "capital",
  ],
  legal: ["lawyer", "attorney", "legal", "counsel", "compliance", "paralegal"],
  operations: [
    "operations", "ops", "logistics", "supply chain", "project manager", "program manager",
  ],
  hr: ["hr", "human resources", "recruiter", "talent", "people ops", "people"],
  product: ["product manager", "product owner", "pm", "scrum", "agile", "product"],
  executive: ["ceo", "founder", "co-founder", "president", "vp", "director", "head of"],
}

// Pairs of buckets whose members could make valuable introductions across the boundary
const ADJACENT = new Set([
  "tech:design",
  "tech:product",
  "tech:sales",
  "marketing:design",
  "marketing:sales",
  "sales:operations",
  "finance:executive",
  "hr:executive",
  "product:design",
])

function assignBucket(contact: Contact): string {
  const text = [contact.title ?? "", contact.tags ?? ""].join(" ").toLowerCase()
  for (const [bucket, keywords] of Object.entries(BUCKETS)) {
    if (keywords.some((kw) => text.includes(kw))) return bucket
  }
  return "general"
}

function areAdjacent(a: string, b: string): boolean {
  return ADJACENT.has(`${a}:${b}`) || ADJACENT.has(`${b}:${a}`)
}

// Canonical key: smaller id first so A↔B === B↔A
function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`
}

function richness(c: Contact): number {
  return [c.title, c.company, c.tags, c.profile].filter(Boolean).length
}

type Candidate = { a: Contact; b: Contact; shared: string }

export async function generateIntroductionSuggestions(
  contacts: Contact[],
  respondedPairs: Set<string>
): Promise<IntroductionCandidate[]> {
  if (contacts.length < 2) return []

  const bucketed = contacts.map((c) => ({ contact: c, bucket: assignBucket(c) }))
  const candidates: Candidate[] = []
  const seen = new Set<string>()

  for (let i = 0; i < bucketed.length; i++) {
    for (let j = i + 1; j < bucketed.length; j++) {
      const a = bucketed[i]
      const b = bucketed[j]
      const key = pairKey(a.contact.id, b.contact.id)
      if (seen.has(key) || respondedPairs.has(key)) continue
      if (a.bucket === b.bucket || areAdjacent(a.bucket, b.bucket)) {
        seen.add(key)
        candidates.push({
          a: a.contact,
          b: b.contact,
          shared: a.bucket === b.bucket ? a.bucket : `${a.bucket}/${b.bucket}`,
        })
      }
    }
  }

  if (candidates.length === 0) return []

  // Prefer richer contacts — more data = better suggestions; cap at 30 for token budget
  const top = candidates
    .sort((x, y) => richness(y.a) + richness(y.b) - (richness(x.a) + richness(x.b)))
    .slice(0, 30)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return buildFallback(top)

  return callClaude(top, apiKey)
}

function formatSummary(c: Contact): string {
  return [
    `Name: ${c.name}`,
    c.title ? `Title: ${c.title}` : null,
    c.company ? `Company: ${c.company}` : null,
    c.tags ? `Tags: ${c.tags}` : null,
    c.profile ? `Profile: ${c.profile.slice(0, 200)}` : null,
  ]
    .filter(Boolean)
    .join(", ")
}

async function callClaude(candidates: Candidate[], apiKey: string): Promise<IntroductionCandidate[]> {
  const pairList = candidates
    .map(
      (c, i) =>
        `${i + 1}. [domain: ${c.shared}]\n   A: ${formatSummary(c.a)}\n   B: ${formatSummary(c.b)}`
    )
    .join("\n\n")

  const userMessage = `Here are candidate pairs from a personal professional network. Analyze each and decide which would genuinely benefit from an introduction.

${pairList}

Return raw JSON only (no markdown fences):
{
  "suggestions": [
    {
      "pairIndex": <1-based integer>,
      "score": <0.0-10.0>,
      "rationale": "<1-2 sentences explaining the specific value of connecting them>"
    }
  ]
}

Rules:
- Only include pairs with score >= 6.0
- Be selective — 3-5 strong matches beats 10 weak ones
- Rationale must be specific to these two people, not generic
- Order by score descending`

  try {
    const client = new Anthropic({ apiKey })
    const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001"

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system:
        "You are a professional networking analyst. Identify genuinely valuable introduction opportunities between people in someone's network. Focus on complementary skills, shared professional interests, or mutual benefit. Return only valid JSON.",
      messages: [{ role: "user", content: userMessage }],
    })

    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : ""
    // Strip markdown code fences if the model wraps the JSON
    const jsonText = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    const parsed = JSON.parse(jsonText) as {
      suggestions: Array<{ pairIndex: number; score: number; rationale: string }>
    }

    return parsed.suggestions
      .filter((s) => s.pairIndex >= 1 && s.pairIndex <= candidates.length && s.score >= 6)
      .map((s) => {
        const c = candidates[s.pairIndex - 1]
        const [idA, idB] = c.a.id < c.b.id ? [c.a.id, c.b.id] : [c.b.id, c.a.id]
        return { contactAId: idA, contactBId: idB, rationale: s.rationale, score: s.score }
      })
  } catch (err) {
    console.error("Claude introduction analysis failed, using fallback:", err)
    return buildFallback(candidates)
  }
}

function buildFallback(candidates: Candidate[]): IntroductionCandidate[] {
  return candidates.slice(0, 5).map((c) => {
    const [idA, idB] = c.a.id < c.b.id ? [c.a.id, c.b.id] : [c.b.id, c.a.id]
    return {
      contactAId: idA,
      contactBId: idB,
      rationale: `Both work in ${c.shared} — connecting them could open up new opportunities or collaborations.`,
      score: 6.0,
    }
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected output: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/introductions.ts
git commit -m "feat: add introduction suggestion engine with Claude Haiku + bucket pre-filter"
```

---

## Task 5: Create GET + POST /api/suggestions

**Files:**
- Create: `app/api/suggestions/route.ts`

**Interfaces:**
- Consumes: `generateIntroductionSuggestions` from `@/lib/introductions`; `resolveOwner`, `ownerWhere` from `@/lib/auth`; `prisma` from `@/lib/prisma`; `Contact` from `@/lib/types`
- Produces:
  - `GET /api/suggestions` → `Suggestion[]` (pending only, score desc, max 5, includes `contactA` and `contactB` nested objects)
  - `POST /api/suggestions` → `{ generated: number }`

- [ ] **Step 1: Create `app/api/suggestions/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"
import { generateIntroductionSuggestions } from "@/lib/introductions"
import type { Contact } from "@/lib/types"

export async function GET() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const rows = await prisma.suggestion.findMany({
    where: { ...ownerWhere(owner.userId), status: "pending" },
    include: {
      contactA: { select: { id: true, name: true, title: true, company: true } },
      contactB: { select: { id: true, name: true, title: true, company: true } },
    },
    orderBy: { score: "desc" },
    take: 5,
  })

  return NextResponse.json(rows)
}

export async function POST() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const rows = await prisma.contact.findMany({
    where: ownerWhere(owner.userId),
    select: { id: true, name: true, title: true, company: true, tags: true, profile: true },
  })

  // Map to Contact shape — only the fields introductions.ts needs
  const contacts: Contact[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: null,
    phone: null,
    company: r.company,
    title: r.title,
    location: null,
    tags: r.tags,
    birthday: null,
    howWeMet: null,
    customFields: null,
    profile: r.profile,
    profileModel: null,
    profileUpdatedAt: null,
    healthScore: null,
    healthTier: null,
    healthInputs: null,
    followUpCadence: null,
    followUpCadenceDays: null,
    createdAt: "",
    updatedAt: "",
  }))

  // Fetch pairs that have already been responded to (accepted or dismissed)
  // so they are excluded from the next generation run
  const responded = await prisma.suggestion.findMany({
    where: {
      ...ownerWhere(owner.userId),
      status: { in: ["dismissed", "accepted"] },
    },
    select: { contactAId: true, contactBId: true },
  })
  const respondedPairs = new Set(
    responded.map((d) => `${d.contactAId}:${d.contactBId}`)
  )

  const candidates = await generateIntroductionSuggestions(contacts, respondedPairs)

  let generated = 0
  for (const c of candidates) {
    await prisma.suggestion.upsert({
      where: {
        contactAId_contactBId: { contactAId: c.contactAId, contactBId: c.contactBId },
      },
      update: {
        rationale: c.rationale,
        score: c.score,
        generatedAt: new Date(),
        status: "pending",
      },
      create: {
        userId: owner.userId,
        contactAId: c.contactAId,
        contactBId: c.contactBId,
        rationale: c.rationale,
        score: c.score,
        status: "pending",
      },
    })
    generated++
  }

  return NextResponse.json({ generated })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected output: no errors.

- [ ] **Step 3: Smoke-test GET (dev server must be running)**

```bash
curl http://localhost:3000/api/suggestions
```

Expected output: `[]` (empty array — no suggestions generated yet).

- [ ] **Step 4: Smoke-test POST**

```bash
curl -X POST http://localhost:3000/api/suggestions
```

Expected output: `{"generated":0}` if fewer than 2 contacts exist, or `{"generated":<n>}` if contacts exist.

- [ ] **Step 5: Commit**

```bash
git add app/api/suggestions/route.ts
git commit -m "feat: add GET + POST /api/suggestions routes"
```

---

## Task 6: Create PATCH /api/suggestions/[id]

**Files:**
- Create: `app/api/suggestions/[id]/route.ts`

**Interfaces:**
- Consumes: `prisma`, `resolveOwner`, `ownerWhere`
- Produces: `PATCH /api/suggestions/:id` → updated suggestion row (or 400/404)

- [ ] **Step 1: Create `app/api/suggestions/[id]/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const body = await req.json().catch(() => ({}))
  const { status } = body as { status?: string }

  if (status !== "accepted" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be 'accepted' or 'dismissed'" },
      { status: 400 }
    )
  }

  const suggestion = await prisma.suggestion.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
  })
  if (!suggestion) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const updated = await prisma.suggestion.update({
    where: { id },
    data: { status, respondedAt: new Date() },
  })

  return NextResponse.json(updated)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected output: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/suggestions/[id]/route.ts"
git commit -m "feat: add PATCH /api/suggestions/[id] for accept/dismiss"
```

---

## Task 7: Create SuggestedIntroductions Dashboard Component

**Files:**
- Create: `components/SuggestedIntroductions.tsx`

**Interfaces:**
- Consumes: `Suggestion` from `@/lib/types`; `GET /api/suggestions`; `POST /api/suggestions`; `PATCH /api/suggestions/:id`
- Produces: A `"use client"` React component with no required props — drop it anywhere

- [ ] **Step 1: Create `components/SuggestedIntroductions.tsx`**

```typescript
"use client"

import { useCallback, useEffect, useState } from "react"
import type { Suggestion } from "@/lib/types"

const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-red-400",
  "bg-sky-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-teal-500",
]

function avatarColor(name: string) {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length]
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(name)}`}
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  )
}

export default function SuggestedIntroductions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/suggestions")
      if (res.ok) setSuggestions(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleAction(id: string, status: "accepted" | "dismissed") {
    // Optimistic removal
    setSuggestions((prev) => prev.filter((s) => s.id !== id))
    await fetch(`/api/suggestions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      await fetch("/api/suggestions", { method: "POST" })
      await load()
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">🤝 Suggested Introductions</h2>
        <button
          onClick={handleGenerate}
          disabled={generating || loading}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          {generating ? "Analyzing…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No suggestions yet.{" "}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-indigo-600 hover:underline disabled:opacity-50"
          >
            Analyze your network →
          </button>
        </p>
      ) : (
        <ul className="space-y-3">
          {suggestions.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-zinc-100 bg-zinc-50 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <Avatar name={s.contactA.name} />
                <span className="text-sm font-medium text-zinc-700">
                  {s.contactA.name}
                </span>
                <span className="text-xs text-zinc-400">↔</span>
                <Avatar name={s.contactB.name} />
                <span className="text-sm font-medium text-zinc-700">
                  {s.contactB.name}
                </span>
                <span className="ml-auto flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                  {s.score.toFixed(1)}
                </span>
              </div>
              <p className="mb-2 text-xs text-zinc-500">{s.rationale}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction(s.id, "accepted")}
                  className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  ✓ Introduce
                </button>
                <button
                  onClick={() => handleAction(s.id, "dismissed")}
                  className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-200"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected output: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/SuggestedIntroductions.tsx
git commit -m "feat: add SuggestedIntroductions dashboard component"
```

---

## Task 8: Integrate into Dashboard

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `SuggestedIntroductions` from `@/components/SuggestedIntroductions`

The component goes directly after the existing `<InsightsFeed />` section (lines 129–131 in the current file).

- [ ] **Step 1: Add the import to `app/dashboard/page.tsx`**

Add after the existing imports at the top of the file:

```typescript
import SuggestedIntroductions from "@/components/SuggestedIntroductions"
```

- [ ] **Step 2: Add the component to the JSX**

Find the `<InsightsFeed />` section:

```tsx
      <div className="mb-6">
        <InsightsFeed />
      </div>
```

Add `SuggestedIntroductions` immediately after it:

```tsx
      <div className="mb-6">
        <InsightsFeed />
      </div>

      <div className="mb-6">
        <SuggestedIntroductions />
      </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected output: no errors.

- [ ] **Step 4: Manual end-to-end test**

1. Start the dev server: `npm run dev`
2. Open `http://localhost:3000/dashboard`
3. Confirm the "🤝 Suggested Introductions" panel renders below the Insights Feed
4. Click **Analyze your network →** (or the Refresh button)
5. Confirm the button shows "Analyzing…" while the POST is in-flight
6. Confirm suggestions appear with Contact A ↔ Contact B, rationale, score badge, and Introduce/Dismiss buttons
7. Click **Dismiss** on one suggestion — confirm it disappears immediately
8. Click **Refresh** — confirm the dismissed pair does not reappear
9. Click **✓ Introduce** on another — confirm it disappears immediately
10. Click **Refresh** — confirm the accepted pair does not reappear

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: add Suggested Introductions section to dashboard"
```

---

## Self-Review

**Spec coverage:**
- ✅ `Suggestion` model (two contacts, rationale, score, status, timestamps)
- ✅ Claude analyzes contact profiles/notes/fields
- ✅ Pre-filtering candidates by overlap (keyword buckets, cap 30)
- ✅ Ranked suggestions with reasons
- ✅ `POST /api/suggestions` — generate
- ✅ `GET /api/suggestions` — fetch
- ✅ `PATCH /api/suggestions/[id]` — accept/dismiss
- ✅ Scoped to authenticated user via `resolveOwner()`/`ownerWhere()`
- ✅ Dashboard section with Contact A ↔ Contact B, rationale, accept/dismiss
- ✅ Dismissed pairs excluded from `respondedPairs` set → never passed to Claude → never regenerated

**Placeholder scan:** None found.

**Type consistency:**
- `IntroductionCandidate` defined in Task 4, consumed in Task 5 — matches
- `Suggestion` type defined in Task 3, consumed in Task 7 — matches
- `pairKey()` returns `smallerId:largerId` — matches the format stored in `respondedPairs` in Task 5 (`${d.contactAId}:${d.contactBId}` where contactAId < contactBId is guaranteed by the upsert normalization in Task 5)
- `contactAId_contactBId` compound unique name matches Prisma-generated name for `@@unique([contactAId, contactBId])`
