# Birthday Gift Recommendations — Design Spec

**Date:** 2026-06-18  
**Status:** Approved

---

## Overview

When a contact's birthday is within 30 days, the contact detail page surfaces 3 AI-generated gift suggestions with rationale. The user can regenerate suggestions and select one to log it as a note on the contact.

---

## Trigger Condition

The gift recommendations section is rendered only when:
1. The contact has a `birthday` field set, AND
2. `daysUntilBirthday(contact.birthday)` returns a value between 0 and 30 (inclusive)

If either condition is false, the section is not rendered. Reuses the existing `daysUntilBirthday()` utility from `lib/birthday.ts`.

---

## Architecture

Follows the existing profile generation pattern (`lib/profile.ts` → `app/api/contacts/[id]/profile/route.ts`).

### `lib/gifts.ts`
- Accepts a contact object (name, title, company, customFields, howWeMet) and an array of recent note contents (up to 5 most recent)
- Builds a prompt instructing the AI to return exactly 3 gift ideas as structured JSON: `{ suggestions: [{ title: string, rationale: string }] }`
- Calls OpenAI with the configured model (`OPENAI_MODEL`, default `gpt-4o-mini`)
- **Fallback (no API key):** Returns 3 generic but contextual suggestions derived deterministically from the contact's fields (e.g., if `customFields` contains "Interests: coffee" → include a coffee-related suggestion)
- Returns: `GiftSuggestion[]` where `GiftSuggestion = { title: string, rationale: string }`

### `app/api/contacts/[id]/gifts/route.ts`
- `POST /api/contacts/[id]/gifts`
- Fetches the contact by ID (verifies it exists)
- Fetches the 5 most recent notes for the contact
- Calls `generateGiftSuggestions(contact, noteContents)` from `lib/gifts.ts`
- Returns `{ suggestions: GiftSuggestion[] }`
- Error: 404 if contact not found, 500 on generation failure

### `app/contacts/[id]/GiftSuggestions.tsx` (new component)
- Client component
- Props: `contactId: string`, `contactName: string`, `daysUntil: number`
- On mount: auto-calls the POST endpoint to fetch initial suggestions
- State: `suggestions`, `loading`, `error`, `selectedIndex`
- Renders the gift card UI (see UI section below)
- On gift selection: POSTs to `app/api/contacts/[id]/notes/route.ts` to create a note with content `🎁 Gift idea: [title] — [rationale]` and `source: "gift"`
- After note saved: shows a brief confirmation ("Saved as note ✓")

---

## UI

Placed on the contact detail page (`app/contacts/[id]/page.tsx`) below the AI profile section, conditional on the trigger.

```
┌─────────────────────────────────────────────────────┐
│ 🎂  Marco's birthday is in 5 days!                  │
│                                                     │
│  🎁 Gift Suggestions                    [Regenerate]│
│  ─────────────────────────────────────────────────  │
│  ○  Specialty Coffee Subscription                   │
│     Marco loves coffee and travels often — a        │
│     curated roaster subscription fits perfectly.    │
│                                                     │
│  ○  Tech Book: "Designing Data-Intensive Apps"      │
│     He's in software and mentioned learning         │
│     distributed systems in your last note.          │
│                                                     │
│  ○  Noise-Cancelling Earbuds                        │
│     Remote worker who does deep focus sessions.     │
└─────────────────────────────────────────────────────┘
```

- Birthday countdown header: "🎂 [Name]'s birthday is today! 🎉" / "in X days"
- Each gift is a clickable card. Clicking one:
  1. Highlights the card (selected state)
  2. POSTs the note to the contact
  3. Shows "Saved as note ✓" inline on the card
- Each gift can be selected independently. Selecting a gift saves it as a note. The user may select multiple gifts — each becomes its own separate note. Already-selected gifts show "Saved ✓" and cannot be re-selected.
- **Regenerate button:** Clears current suggestions, shows spinner, fetches fresh suggestions from the API. Resets selected state.
- **Loading state:** 3 skeleton card placeholders while fetching
- **Error state:** "Couldn't load suggestions. [Try again]" link

---

## Note Source

The Note model already has a `source` field (manual / voice / story). Gift-logged notes will use `source: "gift"` to distinguish them in future use.

> The Prisma Note schema does not need a migration — `source` is already a `String` with a default, so passing `"gift"` works without schema changes.

---

## Data Scope

No auth is currently active. The API route fetches the contact by ID from the shared database — consistent with how all other endpoints work today.

---

## Out of Scope

- Persisting generated suggestions to the database (suggestions are ephemeral; re-opening the page triggers a fresh generation)
- Push notifications or scheduled birthday reminders
- Gift purchase links or external integrations
- Multiple saved gift picks UI (each selection independently becomes a note)
