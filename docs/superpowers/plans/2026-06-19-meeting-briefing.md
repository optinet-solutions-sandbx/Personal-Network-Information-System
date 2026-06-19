# Meeting Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "Prepare for meeting" button to the contact page that generates a pre-meeting briefing via OpenAI and displays it in a modal with a clipboard copy action.

**Architecture:** A pure `lib/briefing.ts` function (OpenAI call + template fallback) is invoked by a new `POST /api/contacts/:id/briefing` route (auth-gated, no DB writes). A self-contained `MeetingBriefingModal` client component renders the trigger button inline in the contact page's `DetailsCard` header and manages modal state (loading → success → error).

**Tech Stack:** Next.js 16 App Router, React 19, OpenAI SDK (`openai` ^6), Prisma, Supabase auth (`resolveOwner`/`ownerWhere` from `lib/auth.ts`), Tailwind CSS v4, Vitest.

## Global Constraints

- All API routes must call `resolveOwner()` and gate on `owner.ok` before any DB access — same pattern as `app/api/contacts/[id]/profile/route.ts`.
- DB queries must use `ownerWhere(owner.userId)` in the `where` clause to scope to the authenticated user.
- OpenAI model: read `process.env.OPENAI_MODEL ?? "gpt-4o-mini"`, temperature `0.4`.
- No DB migrations — nothing is stored.
- No new npm packages — `openai` is already installed.
- Tests live in `tests/` and are picked up by `vitest` via `tests/**/*.test.ts`.
- Path alias `@/` resolves to the project root (configured in `vitest.config.ts`).
- `Markdown` component: named export from `@/components/Markdown`, prop is `content: string`.

---

### Task 1: `lib/briefing.ts` with unit tests

**Files:**
- Create: `lib/briefing.ts`
- Create: `tests/briefing.test.ts`

**Interfaces:**
- Produces:
  - `BriefingInput` — exported type (see step 3)
  - `BriefingResult` — exported type `{ briefing: string; model: string }`
  - `buildUserMessage(input: BriefingInput): string` — exported, pure, testable
  - `buildFallback(input: BriefingInput): string` — exported, pure, testable
  - `generateBriefing(input: BriefingInput): Promise<BriefingResult>` — exported async function consumed by the API route in Task 2

- [ ] **Step 1: Write the failing tests**

Create `tests/briefing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFallback, buildUserMessage } from "@/lib/briefing";

const BASE = {
  name: "Alice Nguyen",
  notes: [] as { content: string; createdAt: string }[],
};

describe("buildFallback", () => {
  it("always includes Who They Are and Suggested Talking Points", () => {
    const result = buildFallback(BASE);
    expect(result).toContain("### Who They Are");
    expect(result).toContain("### Suggested Talking Points");
  });

  it("includes the contact name in the Who They Are section", () => {
    const result = buildFallback(BASE);
    expect(result).toContain("Alice Nguyen");
  });

  it("includes Recent Notes section when notes are present", () => {
    const result = buildFallback({
      ...BASE,
      notes: [{ content: "Discussed the Q3 roadmap.", createdAt: "2026-06-01T10:00:00Z" }],
    });
    expect(result).toContain("### Recent Notes");
    expect(result).toContain("Discussed the Q3 roadmap.");
  });

  it("omits Recent Notes section when there are no notes", () => {
    const result = buildFallback(BASE);
    expect(result).not.toContain("### Recent Notes");
  });

  it("mentions the company in talking points when company is set", () => {
    const result = buildFallback({ ...BASE, company: "Acme Corp" });
    expect(result).toContain("Acme Corp");
  });

  it("includes Key Facts when howWeMet is set", () => {
    const result = buildFallback({ ...BASE, howWeMet: "Conference in 2024" });
    expect(result).toContain("### Key Facts");
    expect(result).toContain("Conference in 2024");
  });

  it("omits Key Facts section when no fact fields are filled", () => {
    const result = buildFallback(BASE);
    expect(result).not.toContain("### Key Facts");
  });

  it("appends the fallback disclaimer", () => {
    const result = buildFallback(BASE);
    expect(result).toContain("OPENAI_API_KEY");
  });
});

describe("buildUserMessage", () => {
  it("includes non-null contact fields", () => {
    const result = buildUserMessage({
      ...BASE,
      title: "VP of Engineering",
      company: "Acme Corp",
    });
    expect(result).toContain("VP of Engineering");
    expect(result).toContain("Acme Corp");
  });

  it("omits null fields", () => {
    const result = buildUserMessage({ ...BASE, email: null, phone: null });
    expect(result).not.toContain("Email:");
    expect(result).not.toContain("Phone:");
  });

  it("formats notes with a date prefix", () => {
    const result = buildUserMessage({
      ...BASE,
      notes: [{ content: "Great call.", createdAt: "2026-06-10T09:00:00Z" }],
    });
    expect(result).toContain("Note 1 (");
    expect(result).toContain("Great call.");
  });

  it("uses '(no notes yet)' when notes array is empty", () => {
    const result = buildUserMessage(BASE);
    expect(result).toContain("(no notes yet)");
  });

  it("includes custom fields when present", () => {
    const result = buildUserMessage({
      ...BASE,
      customFields: { Hobbies: "Cycling", Industry: "Fintech" },
    });
    expect(result).toContain("Hobbies: Cycling");
    expect(result).toContain("Industry: Fintech");
  });

  it("appends existing profile when present", () => {
    const result = buildUserMessage({
      ...BASE,
      profile: "### Summary\nSenior leader at Acme.",
    });
    expect(result).toContain("Senior leader at Acme.");
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```
npx vitest run tests/briefing.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/briefing'`

- [ ] **Step 3: Implement `lib/briefing.ts`**

Create `lib/briefing.ts`:

```ts
import OpenAI from "openai";

export type BriefingInput = {
  name: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  tags?: string | null;
  howWeMet?: string | null;
  birthday?: string | null;
  customFields?: Record<string, string> | null;
  profile?: string | null;
  notes: { content: string; createdAt: Date | string }[];
};

export type BriefingResult = { briefing: string; model: string };

const SYSTEM_PROMPT = `You are a relationship-intelligence assistant helping someone prepare for a meeting.
Given structured contact details and notes, write a concise pre-meeting briefing.

Return GitHub-flavored markdown with these sections (omit a section entirely if there is nothing useful to say):

### Who They Are
One or two sentences — name, role, company, and how this relationship formed.

### Key Facts
A bullet list of notable facts: location, how they met, tags, upcoming birthday if within 30 days, and any standout custom fields.

### Recent Notes
A concise summary of the last few recorded interactions and observations.

### Open Follow-Ups
Any unresolved items, promises, or action items implied by the notes. If none are apparent, omit this section.

### Suggested Talking Points
3–4 specific conversation starters grounded in the notes and profile. Avoid generic openers.

Be concise. Ground every claim in the provided information. Do not invent facts.`;

export function buildUserMessage(input: BriefingInput): string {
  const fields = [
    ["Name", input.name],
    ["Title", input.title],
    ["Company", input.company],
    ["Location", input.location],
    ["Email", input.email],
    ["Phone", input.phone],
    ["Tags", input.tags],
    ["How we met", input.howWeMet],
    ["Birthday", input.birthday],
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

  const notes = input.notes.length
    ? input.notes
        .map((n, i) => {
          const date = new Date(n.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          return `Note ${i + 1} (${date}): ${n.content}`;
        })
        .join("\n")
    : "(no notes yet)";

  const profileSection = input.profile
    ? `\nExisting relationship profile:\n${input.profile}`
    : "";

  return [
    `Contact details:\n${fields || "(none)"}`,
    custom ? `Additional info:\n${custom}` : "",
    profileSection,
    `Notes (most recent first):\n${notes}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildFallback(input: BriefingInput): string {
  const lines: string[] = [];

  lines.push("### Who They Are");
  const roleBits = [input.title, input.company && `at ${input.company}`]
    .filter(Boolean)
    .join(" ");
  const locationBit = input.location ? ` Based in ${input.location}.` : "";
  const metBit = input.howWeMet ? ` Met via: ${input.howWeMet}.` : "";
  lines.push(
    `${input.name}${roleBits ? ` — ${roleBits}` : ""}.${locationBit}${metBit}`
  );

  const facts: string[] = [];
  if (input.location) facts.push(`Location: ${input.location}`);
  if (input.howWeMet) facts.push(`How you met: ${input.howWeMet}`);
  if (input.tags) facts.push(`Tags: ${input.tags}`);
  if (input.customFields) {
    for (const [k, v] of Object.entries(input.customFields)) {
      if (v) facts.push(`${k}: ${v}`);
    }
  }
  if (facts.length) {
    lines.push("\n### Key Facts");
    for (const f of facts) lines.push(`- ${f}`);
  }

  if (input.notes.length) {
    lines.push("\n### Recent Notes");
    for (const n of input.notes.slice(0, 5)) lines.push(`- ${n.content}`);
  }

  lines.push("\n### Suggested Talking Points");
  if (input.company) lines.push(`- Ask about recent developments at ${input.company}.`);
  if (input.notes.length) lines.push("- Follow up on your most recent conversation.");
  lines.push("- Share something relevant you've come across since you last spoke.");
  lines.push("- Ask what they're currently focused on.");

  lines.push(
    "\n> _Generated by the local fallback profiler. Add an OPENAI_API_KEY to enable full AI briefings._"
  );

  return lines.join("\n");
}

export async function generateBriefing(
  input: BriefingInput
): Promise<BriefingResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { briefing: buildFallback(input), model: "fallback" };
  }

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return { briefing: buildFallback(input), model: "fallback" };
    return { briefing: text, model: completion.model || model };
  } catch (err) {
    console.error("OpenAI briefing generation failed, using fallback:", err);
    return { briefing: buildFallback(input), model: "fallback" };
  }
}
```

- [ ] **Step 4: Run the tests — confirm they pass**

```
npx vitest run tests/briefing.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```
git add lib/briefing.ts tests/briefing.test.ts
git commit -m "feat: add generateBriefing lib with fallback and unit tests"
```

---

### Task 2: `POST /api/contacts/:id/briefing` route

**Files:**
- Create: `app/api/contacts/[id]/briefing/route.ts`

**Interfaces:**
- Consumes: `generateBriefing(input: BriefingInput): Promise<BriefingResult>` from `@/lib/briefing`
- Consumes: `resolveOwner`, `ownerWhere` from `@/lib/auth`
- Consumes: `prisma` from `@/lib/prisma`
- Produces: `POST /api/contacts/:id/briefing` → `200 { briefing: string }` | `401` | `404 { error: "not found" }` | `502 { error: "generation failed" }`

- [ ] **Step 1: Create the route file**

Create `app/api/contacts/[id]/briefing/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateBriefing } from "@/lib/briefing";
import { resolveOwner, ownerWhere } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    include: { notes: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let customFields: Record<string, string> | null = null;
  if (contact.customFields) {
    try {
      customFields = JSON.parse(contact.customFields) as Record<string, string>;
    } catch {
      customFields = null;
    }
  }

  try {
    const { briefing } = await generateBriefing({
      name: contact.name,
      title: contact.title,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
      location: contact.location,
      tags: contact.tags,
      howWeMet: contact.howWeMet,
      birthday: contact.birthday,
      customFields,
      profile: contact.profile,
      notes: contact.notes.map((n) => ({
        content: n.content,
        createdAt: n.createdAt,
      })),
    });
    return NextResponse.json({ briefing });
  } catch (err) {
    console.error("Briefing route failed:", err);
    return NextResponse.json({ error: "generation failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Smoke-test the route manually**

Start the dev server (`npm run dev`), open any contact page, open DevTools → Network, and run in the console:

```js
fetch('/api/contacts/<PASTE_A_REAL_CONTACT_ID>/briefing', { method: 'POST' })
  .then(r => r.json()).then(console.log)
```

Expected: `{ briefing: "### Who They Are\n..." }` (either AI or fallback text).

- [ ] **Step 3: Commit**

```
git add app/api/contacts/[id]/briefing/route.ts
git commit -m "feat: add POST /api/contacts/:id/briefing route"
```

---

### Task 3: `MeetingBriefingModal` component + wire into contact page

**Files:**
- Create: `components/MeetingBriefingModal.tsx`
- Modify: `app/contacts/[id]/page.tsx` (2 edits — import + render inside `DetailsCard`)

**Interfaces:**
- Consumes: `contact: Contact` from `@/lib/types`
- Consumes: `Markdown` named export from `@/components/Markdown`
- Renders a trigger button + fixed modal overlay; no props are callbacks

- [ ] **Step 1: Create `components/MeetingBriefingModal.tsx`**

```tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import { Markdown } from "@/components/Markdown";
import type { Contact } from "@/lib/types";

type ModalState = "idle" | "loading" | "success" | "error";

export function MeetingBriefingModal({ contact }: { contact: Contact }) {
  const [state, setState] = useState<ModalState>("idle");
  const [briefing, setBriefing] = useState("");

  const generate = useCallback(async () => {
    setState("loading");
    setBriefing("");
    try {
      const res = await fetch(`/api/contacts/${contact.id}/briefing`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { briefing: string };
      setBriefing(data.briefing);
      setState("success");
    } catch {
      setState("error");
    }
  }, [contact.id]);

  const close = useCallback(() => {
    setState("idle");
    setBriefing("");
  }, []);

  useEffect(() => {
    if (state === "idle") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  return (
    <>
      <button
        onClick={generate}
        className="rounded-lg border border-indigo-200 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50"
      >
        Prepare for meeting
      </button>

      {state !== "idle" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
              <h2 className="text-base font-semibold text-zinc-800">
                Meeting Briefing — {contact.name}
              </h2>
              <button
                onClick={close}
                className="text-zinc-400 hover:text-zinc-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {state === "loading" && (
                <div className="flex flex-col items-center gap-3 py-12 text-zinc-400">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                  <p className="text-sm">Generating briefing…</p>
                </div>
              )}
              {state === "success" && <Markdown content={briefing} />}
              {state === "error" && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-red-600">
                    Couldn&apos;t generate briefing — the AI service may be
                    unavailable.
                  </p>
                  <button
                    onClick={generate}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>

            {state === "success" && (
              <div className="flex justify-end gap-2 border-t border-zinc-100 px-6 py-3">
                <CopyButton text={briefing} />
                <button
                  onClick={close}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={copy}
      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
```

- [ ] **Step 2: Add the import to `app/contacts/[id]/page.tsx`**

In `app/contacts/[id]/page.tsx`, the existing imports are at the top of the file. Add `MeetingBriefingModal` to the import list:

```ts
// Add this line after the GiftSuggestions import (around line 13)
import { MeetingBriefingModal } from "@/components/MeetingBriefingModal";
```

- [ ] **Step 3: Render the modal trigger in `DetailsCard`**

In `app/contacts/[id]/page.tsx`, find the non-editing button row inside `DetailsCard` (around line 261–276). It currently reads:

```tsx
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
```

Replace it with (add `MeetingBriefingModal` before the Edit button):

```tsx
) : (
  <>
    <MeetingBriefingModal contact={contact} />
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
```

- [ ] **Step 4: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual end-to-end test**

With `npm run dev` running:
1. Open any contact page.
2. Confirm "Prepare for meeting" button appears in the header row.
3. Click it — confirm modal opens with a spinner.
4. Wait for generation — confirm briefing sections render (### headings, bullets).
5. Click "Copy" — confirm the button briefly shows "Copied!".
6. Press Escape — confirm modal closes.
7. Click the backdrop — confirm modal closes.
8. Click "Prepare for meeting" again — confirm a fresh briefing generates (no cached state).

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```
git add components/MeetingBriefingModal.tsx app/contacts/[id]/page.tsx
git commit -m "feat: add MeetingBriefingModal to contact page"
```
