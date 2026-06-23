# Sent Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user clicks Send in `FollowUpDraftModal`, persist the full message to a new `SentMessage` DB table and surface the sent history in a dashboard section and on each contact's detail page.

**Architecture:** New `SentMessage` Prisma model linked to `Contact`; three new API routes (POST create, GET dashboard list, GET contact-scoped list); modal updated to fire-and-forget POST on send + "Send" label added to button; two new React components (`SentMessages` for dashboard, `SentMessagesList` inline section on contact page).

**Tech Stack:** Next.js 15 App Router (client components, `"use client"`), Prisma + PostgreSQL (Supabase), Tailwind CSS, Vitest

## Global Constraints

- All API routes must call `resolveOwner()` and use `ownerWhere(owner.userId)` for data isolation — see `app/api/contacts/[id]/notes/route.ts` for the exact pattern
- `Params` type for dynamic routes: `type Params = { params: Promise<{ id: string }> }` — always `await params`
- Import prisma from `@/lib/prisma`, auth helpers from `@/lib/auth`
- `method` field on SentMessage: `"email"` when contact has an email address, `"clipboard"` when not
- No loading spinners in the modal for the persist call — fire-and-forget, never block the UX
- Tailwind only — no new CSS files

---

### Task 1: Prisma Schema — Add SentMessage Model

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `SentMessage` table with fields `id`, `userId`, `contactId`, `body`, `method`, `sentAt`; `Contact` gains `sentMessages SentMessage[]` relation

- [ ] **Step 1: Add the model and relation to schema.prisma**

Open `prisma/schema.prisma`. Add after the `Suggestion` model (line 92):

```prisma
model SentMessage {
  id        String   @id @default(cuid())
  userId    String?
  contactId String
  contact   Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)

  body      String
  method    String   // "email" | "clipboard"

  sentAt    DateTime @default(now())

  @@index([contactId])
  @@index([userId, sentAt(sort: Desc)])
}
```

Also add to the `Contact` model (after `suggestionsAsB` line 49, before `createdAt`):

```prisma
  sentMessages   SentMessage[]
```

- [ ] **Step 2: Run the migration**

```bash
npx prisma migrate dev --name add_sent_messages
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 3: Verify Prisma client regenerated**

```bash
npx prisma generate
```

Expected output: `Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add SentMessage prisma model"
```

---

### Task 2: TypeScript Type + Validation

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/validation.ts`
- Create: `tests/sent-messages.test.ts`

**Interfaces:**
- Produces: `SentMessage` type exported from `lib/types.ts`; `validateSentMessageBody(body: unknown)` exported from `lib/validation.ts` returning `{ ok: true, data: { contactId: string; body: string; method: "email" | "clipboard" } } | { ok: false; error: string }`

- [ ] **Step 1: Add SentMessage type to lib/types.ts**

Append to `lib/types.ts`:

```ts
export type SentMessage = {
  id: string
  userId: string | null
  contactId: string
  body: string
  method: "email" | "clipboard"
  sentAt: string
  contact?: { id: string; name: string }
}
```

- [ ] **Step 2: Write the failing validation test**

Create `tests/sent-messages.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { validateSentMessageBody } from "@/lib/validation"

describe("validateSentMessageBody", () => {
  it("accepts valid email method", () => {
    const res = validateSentMessageBody({ contactId: "abc", body: "Hello!", method: "email" })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.contactId).toBe("abc")
      expect(res.data.method).toBe("email")
    }
  })

  it("accepts valid clipboard method", () => {
    const res = validateSentMessageBody({ contactId: "abc", body: "Hello!", method: "clipboard" })
    expect(res.ok).toBe(true)
  })

  it("rejects missing contactId", () => {
    expect(validateSentMessageBody({ body: "Hi", method: "email" }).ok).toBe(false)
  })

  it("rejects empty body", () => {
    expect(validateSentMessageBody({ contactId: "abc", body: "  ", method: "email" }).ok).toBe(false)
  })

  it("rejects invalid method", () => {
    expect(validateSentMessageBody({ contactId: "abc", body: "Hi", method: "fax" }).ok).toBe(false)
  })

  it("rejects non-object input", () => {
    expect(validateSentMessageBody(null).ok).toBe(false)
    expect(validateSentMessageBody("string").ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run test — verify it fails**

```bash
npx vitest run tests/sent-messages.test.ts
```

Expected: FAIL with `validateSentMessageBody is not a function` or similar.

- [ ] **Step 4: Add validateSentMessageBody to lib/validation.ts**

Append to `lib/validation.ts`:

```ts
export function validateSentMessageBody(body: unknown):
  | { ok: true; data: { contactId: string; body: string; method: "email" | "clipboard" } }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" }
  }
  const b = body as Record<string, unknown>
  if (typeof b.contactId !== "string" || !b.contactId.trim()) {
    return { ok: false, error: "contactId is required" }
  }
  if (typeof b.body !== "string" || !b.body.trim()) {
    return { ok: false, error: "body is required" }
  }
  if (b.method !== "email" && b.method !== "clipboard") {
    return { ok: false, error: 'method must be "email" or "clipboard"' }
  }
  return {
    ok: true,
    data: {
      contactId: b.contactId.trim(),
      body: b.body.trim(),
      method: b.method,
    },
  }
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
npx vitest run tests/sent-messages.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/validation.ts tests/sent-messages.test.ts
git commit -m "feat: add SentMessage type and validation"
```

---

### Task 3: API Routes

**Files:**
- Create: `app/api/sent-messages/route.ts`
- Create: `app/api/contacts/[id]/sent-messages/route.ts`

**Interfaces:**
- Consumes: `validateSentMessageBody` from `lib/validation.ts`; `resolveOwner`, `ownerWhere` from `lib/auth`; `prisma` from `lib/prisma`
- Produces:
  - `POST /api/sent-messages` — body `{ contactId, body, method }` → `201 { id, contactId, body, method, sentAt }`
  - `GET /api/sent-messages` → `200 SentMessage[]` (last 20, desc, includes `contact.name`)
  - `GET /api/contacts/[id]/sent-messages` → `200 SentMessage[]` (all for contact, desc)

- [ ] **Step 1: Create app/api/sent-messages/route.ts**

```ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"
import { validateSentMessageBody } from "@/lib/validation"

// POST /api/sent-messages
export async function POST(req: NextRequest) {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const raw = await req.json().catch(() => null)
  const valid = validateSentMessageBody(raw)
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 })
  }

  const { contactId, body, method } = valid.data

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ...ownerWhere(owner.userId) },
    select: { id: true },
  })
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 })
  }

  try {
    const sent = await prisma.sentMessage.create({
      data: { userId: owner.userId, contactId, body, method },
    })
    return NextResponse.json(sent, { status: 201 })
  } catch (err) {
    console.error("POST /api/sent-messages failed:", err)
    return NextResponse.json({ error: "Could not save sent message." }, { status: 500 })
  }
}

// GET /api/sent-messages
export async function GET() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const messages = await prisma.sentMessage.findMany({
    where: ownerWhere(owner.userId),
    orderBy: { sentAt: "desc" },
    take: 20,
    include: { contact: { select: { id: true, name: true } } },
  })
  return NextResponse.json(messages)
}
```

- [ ] **Step 2: Create app/api/contacts/[id]/sent-messages/route.ts**

```ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"

type Params = { params: Promise<{ id: string }> }

// GET /api/contacts/:id/sent-messages
export async function GET(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const { id } = await params

  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    select: { id: true },
  })
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 })
  }

  const messages = await prisma.sentMessage.findMany({
    where: { contactId: id },
    orderBy: { sentAt: "desc" },
  })
  return NextResponse.json(messages)
}
```

- [ ] **Step 3: Smoke-test the POST route**

Start the dev server (`npm run dev`) and in another terminal:

```bash
# Replace CONTACT_ID with a real id from your DB
curl -s -X POST http://localhost:3000/api/sent-messages \
  -H "Content-Type: application/json" \
  -d '{"contactId":"CONTACT_ID","body":"Hello world","method":"clipboard"}' | jq .
```

Expected: `{ "id": "...", "contactId": "...", "body": "Hello world", "method": "clipboard", "sentAt": "..." }`

- [ ] **Step 4: Smoke-test the GET routes**

```bash
curl -s http://localhost:3000/api/sent-messages | jq .
curl -s http://localhost:3000/api/contacts/CONTACT_ID/sent-messages | jq .
```

Expected: JSON arrays (possibly `[]` if nothing sent yet).

- [ ] **Step 5: Commit**

```bash
git add app/api/sent-messages/route.ts app/api/contacts/
git commit -m "feat: add sent-messages API routes (POST + GET)"
```

---

### Task 4: Modal — "Send" Label + Persist on Send

**Files:**
- Modify: `components/FollowUpDraftModal.tsx`

**Interfaces:**
- Consumes: `POST /api/sent-messages`
- The persist call is fire-and-forget — never await it in a way that blocks `setSent(true)`

- [ ] **Step 1: Update the send() function to persist**

In `components/FollowUpDraftModal.tsx`, replace the existing `send()` function (lines 64–76):

```ts
function send() {
  if (!draft.trim()) return
  const method: "email" | "clipboard" = contactEmail ? "email" : "clipboard"
  if (contactEmail) {
    window.open(
      `mailto:${contactEmail}?body=${encodeURIComponent(draft)}`,
      "_blank"
    )
  } else {
    navigator.clipboard.writeText(draft).catch(() => {})
  }
  // Fire-and-forget — persist without blocking the UI
  fetch("/api/sent-messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, body: draft, method }),
  }).catch(() => {})
  setSent(true)
  setTimeout(() => setSent(false), 2500)
}
```

- [ ] **Step 2: Add "Send" text label to the button**

Replace the send button (lines 173–191) with:

```tsx
<button
  onClick={send}
  disabled={!draft.trim()}
  className="flex-shrink-0 flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-2 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
  aria-label={contactEmail ? "Send email" : "Copy message"}
  title={contactEmail ? "Send via email (Ctrl+Enter)" : "Copy to clipboard (Ctrl+Enter)"}
>
  {sent ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22 11 13 2 9l20-7z" />
    </svg>
  )}
  <span className="text-sm font-medium">{sent ? "Sent" : "Send"}</span>
</button>
```

- [ ] **Step 3: Verify in browser**

Open the app, open any contact's follow-up draft modal. Confirm:
- Button shows airplane icon + "Send" text
- Clicking it changes to checkmark + "Sent" for 2.5 seconds
- Network tab shows `POST /api/sent-messages` returning 201

- [ ] **Step 4: Commit**

```bash
git add components/FollowUpDraftModal.tsx
git commit -m "feat: add Send label and persist sent message on modal send"
```

---

### Task 5: Dashboard SentMessages Component

**Files:**
- Create: `components/SentMessages.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/sent-messages` → `Array<{ id, contactId, body, method, sentAt, contact: { id, name } }>`

- [ ] **Step 1: Create components/SentMessages.tsx**

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { SentMessage } from "@/lib/types"

const AVATAR_COLORS = [
  "bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-red-400",
  "bg-sky-500", "bg-violet-500", "bg-pink-500", "bg-teal-500",
]
function avatarColor(name: string) {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length]
}
function initials(name: string) {
  return name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
}
function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function SentMessages() {
  const [messages, setMessages] = useState<SentMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/sent-messages")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setMessages(data))
      .finally(() => setLoading(false))
  }, [])

  function copyMessage(msg: SentMessage) {
    navigator.clipboard.writeText(msg.body).catch(() => {})
    setCopiedId(msg.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h2 className="mb-3 text-lg font-semibold">Sent Messages</h2>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No messages sent yet.</p>
      ) : (
        <ul className="space-y-3">
          {messages.map((msg) => {
            const name = msg.contact?.name ?? "Unknown"
            return (
              <li key={msg.id} className="flex items-start gap-3">
                <Link href={`/contacts/${msg.contactId}`} className="flex-shrink-0">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(name)}`}
                  >
                    {initials(name)}
                  </span>
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={`/contacts/${msg.contactId}`}
                      className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline"
                    >
                      {name}
                    </Link>
                    <span className="text-[10px] text-zinc-400">{relativeTime(msg.sentAt)}</span>
                    <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                      {msg.method === "email" ? "Email" : "Copied"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                    {msg.body}
                  </p>
                </div>
                <button
                  onClick={() => copyMessage(msg)}
                  className="flex-shrink-0 rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  title="Copy message"
                >
                  {copiedId === msg.id ? "Copied!" : "Copy"}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add SentMessages to dashboard page**

In `app/dashboard/page.tsx`, add the import at the top with the other component imports:

```ts
import SentMessages from "@/components/SentMessages"
```

Then add below `<SuggestedIntroductions />` (around line 136):

```tsx
<div className="mb-6">
  <SentMessages />
</div>
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:3000/dashboard`. Confirm:
- "Sent Messages" section appears below Suggested Introductions
- After sending a message via the modal, refresh dashboard — entry appears with contact name, snippet, method badge, relative time, and Copy button
- Clicking Copy button copies full body and briefly shows "Copied!"

- [ ] **Step 4: Commit**

```bash
git add components/SentMessages.tsx app/dashboard/page.tsx
git commit -m "feat: add SentMessages dashboard section"
```

---

### Task 6: Contact Detail — Sent Messages List

**Files:**
- Modify: `app/contacts/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/contacts/[id]/sent-messages` → `SentMessage[]`
- Placed below the `<NotesSection>` in the contact page render

- [ ] **Step 1: Add SentMessage import to contact page**

At the top of `app/contacts/[id]/page.tsx`, add to the existing types import:

```ts
import type { Contact, Note, HealthInputs, SentMessage } from "@/lib/types"
```

- [ ] **Step 2: Add SentMessagesList component to the file**

Append the following component before the final `export default` in `app/contacts/[id]/page.tsx`:

```tsx
function SentMessagesList({ contactId }: { contactId: string }) {
  const [messages, setMessages] = useState<SentMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/sent-messages`)
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setMessages(data))
      .finally(() => setLoading(false))
  }, [contactId])

  function copyMessage(msg: SentMessage) {
    navigator.clipboard.writeText(msg.body).catch(() => {})
    setCopiedId(msg.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h2 className="mb-3 text-lg font-semibold">Sent Messages</h2>
      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No messages sent yet.</p>
      ) : (
        <ul className="space-y-3">
          {messages.map((msg) => {
            const expanded = expandedId === msg.id
            const date = new Date(msg.sentAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
            return (
              <li key={msg.id} className="rounded-lg border border-zinc-100 dark:border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">{date}</span>
                    <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                      {msg.method === "email" ? "Email" : "Copied"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyMessage(msg)}
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      {copiedId === msg.id ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={() => setExpandedId(expanded ? null : msg.id)}
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      {expanded ? "Collapse" : "View"}
                    </button>
                  </div>
                </div>
                {!expanded && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">
                    {msg.body}
                  </p>
                )}
                {expanded && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                    {msg.body}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Render SentMessagesList in the contact page**

Find the section of `app/contacts/[id]/page.tsx` where `<NotesSection>` is rendered. Add `<SentMessagesList>` immediately after it:

```tsx
<SentMessagesList contactId={contact.id} />
```

- [ ] **Step 4: Verify in browser**

Open any contact detail page. Confirm:
- "Sent Messages" section appears below Notes
- Empty state shows "No messages sent yet."
- After sending via the modal, refresh — entry appears with date, method badge
- "View" expands to show full message; "Copy" copies it

- [ ] **Step 5: Commit**

```bash
git add app/contacts/
git commit -m "feat: add SentMessagesList to contact detail page"
```

---

### Task 7: Full run-through

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS including the new `tests/sent-messages.test.ts`.

- [ ] **Step 2: Manual end-to-end**

1. Open dashboard → "Sent Messages" shows empty state
2. Open any contact → click "Draft message" → modal opens with airplane + "Send" label
3. Click Send → button briefly shows checkmark + "Sent"
4. Refresh dashboard → sent entry appears with contact name, snippet, method badge, Copy button
5. Click Copy → briefly shows "Copied!"
6. Open the contact detail page → "Sent Messages" section shows the entry, View/Copy work

- [ ] **Step 3: Final commit if clean**

```bash
git add -A
git commit -m "chore: sent messages feature complete"
```
