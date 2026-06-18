# Relationship Health Score — Design Spec

**Date:** 2026-06-18
**Status:** Approved

## Overview

Compute a 0–100 health/strength score per contact based on recency and frequency of notes, and profile richness. Store the score and its sub-score inputs on the Contact record, recalculate on every data mutation, and display on both the contact detail page and the dashboard contact cards. Scoped to the authenticated user.

---

## Data Model

Three nullable fields added to the existing `Contact` model:

```prisma
healthScore   Int?     // 0–100 composite score
healthTier    String?  // "Strong" | "Active" | "Fading" | "Dormant"
healthInputs  String?  // JSON — see shape below
```

`healthInputs` JSON shape:
```json
{
  "recency": 30,
  "frequency": 22,
  "richness": 21,
  "lastNoteAt": "2026-05-10T14:00:00Z",
  "noteCount90d": 6,
  "filledFields": 7
}
```

---

## Scoring Algorithm

**Total: 100 points across three signals.**

### Recency (max 40 pts)
Based on days since the most recent note's `createdAt`.

| Days since last note | Points |
|---|---|
| ≤ 7 | 40 |
| ≤ 30 | 30 |
| ≤ 90 | 20 |
| ≤ 180 | 10 |
| > 180 or no notes | 0 |

### Frequency (max 30 pts)
Count of notes with `createdAt` within the last 90 days.

| Notes in last 90 days | Points |
|---|---|
| 10+ | 30 |
| 5–9 | 22 |
| 2–4 | 15 |
| 1 | 8 |
| 0 | 0 |

### Profile Richness (max 30 pts)
Count of filled fields across 10 tracked fields: `email`, `phone`, `company`, `title`, `location`, `tags`, `howWeMet`, `birthday`, `customFields`, `profile`. Each filled field = 3 pts.

A field counts as filled if: it is non-null and non-empty string. For `customFields` specifically, it counts only if the parsed JSON object has at least one key (i.e. `{}` does not count). For `tags`, it counts if the string is non-empty after trimming.

### Tiers

| Score | Tier | Color |
|---|---|---|
| 75–100 | Strong | Green |
| 50–74 | Active | Blue |
| 25–49 | Fading | Amber |
| 0–24 | Dormant | Gray |

---

## Calculation Function

**`lib/health.ts`** — pure function, no database access, fully testable.

```ts
type HealthInputs = {
  recency: number
  frequency: number
  richness: number
  lastNoteAt: string | null
  noteCount90d: number
  filledFields: number
}

type HealthResult = {
  score: number
  tier: string
  inputs: HealthInputs
}

function calculateHealthScore(contact: Contact & { notes: Note[] }): HealthResult
```

---

## Recalculation Triggers

A shared server utility `recalculateHealth(contactId: string): Promise<void>` in `lib/health.ts`:
1. Fetches the contact with all notes from the database
2. Calls `calculateHealthScore`
3. Updates the contact's `healthScore`, `healthTier`, `healthInputs` fields

This utility is called at the end of every mutation API route:

| Route | Trigger event |
|---|---|
| `POST /api/contacts/[id]/notes` | Note added |
| `DELETE /api/notes/[id]` | Note deleted |
| `PATCH /api/notes/[id]` | Note edited |
| `PATCH /api/contacts/[id]` | Contact fields updated |
| `POST /api/contacts/[id]/profile` | AI profile generated |
| `POST /api/contacts` | Contact created |

### Backfill

A one-time endpoint `POST /api/contacts/recalculate-all-health` iterates all contacts (with notes), computes and persists health scores. Called once after deployment to populate scores for existing contacts. No auth guard needed beyond being internal.

---

## UI

### Dashboard — Contact Cards (`app/HomePageClient.tsx`)

Each card gains one new line below the name/title row:
- Colored dot (CSS class by tier) + tier label + numeric score in parentheses
- Example: `● Strong (82)`
- No layout restructuring; this fits within the existing card structure.

### Contact Detail Page — `HealthCard` component

New component `app/contacts/[id]/HealthCard.tsx`, rendered between `DetailsCard` and `NotesSection`.

Displays:
- Large composite score (e.g. `82`)
- Tier label with color badge (e.g. green "Strong")
- Three sub-score rows with progress indicators:
  - Recency: X / 40
  - Frequency: X / 30
  - Profile richness: X / 30

The component receives the contact's `healthScore`, `healthTier`, and parsed `healthInputs` as props.

---

## Types

Add to `lib/types.ts`:

```ts
type HealthInputs = {
  recency: number
  frequency: number
  richness: number
  lastNoteAt: string | null
  noteCount90d: number
  filledFields: number
}

// Contact type gains optional health fields
// healthScore?: number
// healthTier?: string
// healthInputs?: HealthInputs
```

---

## Out of Scope

- Follow-up adherence signal (no follow-up model exists)
- Sorting/filtering contacts by health score on the dashboard
- Score history / trend over time
- Per-user score configuration (weights are fixed)
