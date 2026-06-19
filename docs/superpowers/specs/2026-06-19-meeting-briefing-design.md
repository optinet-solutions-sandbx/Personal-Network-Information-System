# Meeting Briefing — Design Spec

**Date:** 2026-06-19
**Status:** Approved

## Overview

Generate a concise pre-meeting briefing for a contact — who they are, recent notes, key facts, open follow-ups, and suggested talking points — produced by OpenAI from the contact's profile and notes. Triggered on-demand from the contact detail page via a modal. Scoped to the authenticated user's contacts. Never stored; always fresh.

---

## Data Flow

1. User clicks **"Prepare for meeting"** button on the contact page.
2. `MeetingBriefingModal` opens and immediately fires `POST /api/contacts/:id/briefing`.
3. Server fetches the contact record + last 10 notes, calls `generateBriefing`, returns `{ briefing: string }`.
4. Modal renders the markdown string via the existing `<Markdown>` component.
5. User copies to clipboard via a "Copy" button in the modal footer.

---

## New Files

### `lib/briefing.ts`

Pure function — no database access, fully testable.

**Input shape:**
```ts
type BriefingInput = {
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
  profile?: string | null; // existing AI profile, if any
  notes: { content: string; createdAt: Date | string }[];
};

type BriefingResult = { briefing: string; model: string };
```

**System prompt** instructs the model to write a focused pre-meeting brief with these sections (omit any section if there is nothing useful to say):

```
### Who They Are
One or two sentences — name, role, company, and relationship context.

### Key Facts
Bullet list of notable facts (location, how you met, upcoming birthday if within 30 days, tags, custom fields).

### Recent Notes
A concise summary of the last few recorded interactions and observations.

### Open Follow-Ups
Any unresolved items, promises, or action items implied by the notes.

### Suggested Talking Points
3–4 specific conversation starters grounded in the notes and profile. Avoid generic openers.
```

The user message is built from all non-null contact fields + notes (newest first). The existing AI profile is appended as additional context if present.

**Fallback** (no `OPENAI_API_KEY`): A template-based markdown string built from the available fields, with a note that it was generated locally.

**Model/temperature:** Reads `OPENAI_MODEL` env var (default `gpt-4o-mini`), temperature `0.4` — same as `lib/profile.ts`.

---

### `app/api/contacts/[id]/briefing/route.ts`

`POST /api/contacts/:id/briefing`

- Auth-gated via `resolveOwner` / `ownerWhere` (same pattern as profile and gifts routes).
- Fetches contact + last 10 notes (`orderBy: { createdAt: "desc" }, take: 10`).
- Parses `customFields` from JSON string.
- Calls `generateBriefing(input)`.
- Returns `{ briefing: string }` on success, `{ error: string }` with status 502 on AI failure.
- No DB writes.

---

### `components/MeetingBriefingModal.tsx`

Client component. Receives `contact: Contact` as a prop.

**Trigger:** A button labelled **"Prepare for meeting"** rendered inline — placed in the `DetailsCard` header row alongside the existing Edit and Delete buttons.

**Modal states:**

| State | UI |
|---|---|
| `idle` | Modal closed; button visible. |
| `loading` | Modal open, centered spinner + "Generating briefing…" text. |
| `success` | Modal open, briefing rendered via `<Markdown>`. Footer: Copy + Close buttons. |
| `error` | Modal open, error message + Retry button + Close button. |

**Modal structure:**
- Fixed overlay (`position: fixed, inset: 0`) with a semi-transparent backdrop.
- Centered card (~`max-w-2xl`, scrollable body, `max-h-[80vh]`).
- Header: "Meeting Briefing — {contact.name}" + X close button.
- Body: scrollable, renders `<Markdown>` on success.
- Footer: Copy button (copies plain-text briefing to clipboard); button text changes to "Copied!" for 2 seconds then resets.

**Keyboard:** `Escape` key closes the modal.

---

## Modified Files

### `app/contacts/[id]/page.tsx`

- Import `MeetingBriefingModal`.
- Pass `contact` to it inside the `DetailsCard` header area.
- The trigger button lives inside `MeetingBriefingModal` (self-contained component), so the page change is minimal: add `<MeetingBriefingModal contact={contact} />` next to the existing Edit/Delete buttons in `DetailsCard`.

---

## Error Handling

- **AI failure (502):** Modal shows "Couldn't generate briefing — the AI service may be unavailable. Try again." with a Retry button that re-fires the request.
- **Network error:** Same error state as above.
- **Contact not found (404):** Unreachable in practice (user is already on the contact page), but the endpoint returns 404 with `{ error: "not found" }`.

---

## Testing

- `lib/briefing.ts` is a pure function — unit-testable with mocked notes and contact fields (same pattern as `lib/health.ts` tests).
- No DB migration required (nothing is stored).
- Manual test: open any contact page → "Prepare for meeting" → verify sections appear → copy to clipboard.

---

## Out of Scope

- Dashboard surface (contact page only for now).
- Caching or storing the briefing in the DB.
- Streaming response.
- Share sheet / download actions.
