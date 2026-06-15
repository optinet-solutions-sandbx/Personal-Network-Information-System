# Networky.ai (PNIS) — Phase 1 MVP

Relationship Intelligence Platform. Phase 1 delivers the core capture-and-enrich loop:

1. **Contacts** — full CRUD + search (name, company, title, tags, email, location)
2. **Notes** — full CRUD with **Speech-to-Text** dictation (browser-native Web Speech API)
3. **AI-Assisted Profiles** — generate a structured relationship profile from a contact's
   details + notes (OpenAI, with a deterministic fallback so it works with no API key)

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS v4**
- **Prisma 6** ORM, **Supabase Postgres** (connected via the Supabase connection pooler)
- **OpenAI** for profile generation (optional; falls back to a local generator)
- **Web Speech API** for STT (no third-party service, no API cost)

## Getting started

```bash
npm install
# Set DATABASE_URL + DIRECT_URL (Supabase) and OPENAI_API_KEY in .env (see .env.example)
npx prisma migrate dev   # applies the schema to Supabase + generates the client
npm run db:seed          # optional: 4 demo contacts with notes
npm run dev              # http://localhost:3000
```

> The database now runs on **Supabase Postgres**. Connection strings live in `.env`
> (`DATABASE_URL` = pooled/transaction, `DIRECT_URL` = session, used for migrations).
> `.env` is gitignored — each developer points at their own Supabase project, or share one.

### Enabling real AI profiles

By default the profiler runs a built-in deterministic fallback (so the demo works with zero
config). To use OpenAI, set in `.env`:

```
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-4o-mini"
```

STT requires a Chromium-based browser (Chrome/Edge) and microphone permission.

## Project layout

```
app/
  page.tsx                       Contacts list + search + add
  contacts/[id]/page.tsx         Detail: edit, notes (CRUD + STT), AI profile
  api/contacts/                  REST handlers (list/search/create/get/update/delete)
  api/contacts/[id]/notes/       Notes create + list
  api/contacts/[id]/profile/     Generate AI profile
  api/notes/[id]/                Note update + delete
lib/
  prisma.ts                      Prisma client singleton
  profile.ts                     OpenAI profiler + fallback
  types.ts                       Client-facing types
hooks/useSpeechRecognition.ts    Web Speech API wrapper
components/Markdown.tsx          Lightweight markdown renderer for profiles
prisma/schema.prisma             Contact + Note models
prisma/seed.mjs                  Demo data
```

## Phase 2: Supabase Auth & Storage

The database is already on Supabase Postgres. The remaining Supabase pieces are additive:

- **Auth** — add Supabase Auth for user sign-in and scope contacts per user/workspace.
- **Storage** — add Supabase Storage for attachments (e.g. business-card photos, voice clips).

These layer on without changing the existing feature code.

## Phase 1 scope note

Deliberately **not** included yet (per scope agreed with Christian): matching/introductions
engine, reminders/birthdays, team workspaces, dashboard. The architecture leaves room for them.
