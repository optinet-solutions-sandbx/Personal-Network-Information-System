# Networky.ai — Phase 1 Demo Script (for Meny)

**Duration:** ~4–5 minutes
**The one question we're validating:** *"Can AI help users capture, enrich, and act on the
relationships hidden in their network — without the data-entry burden that kills every CRM?"*

---

## Before you start (2-min pre-flight)

- [ ] Use **Chrome or Edge** (Speech-to-Text uses the Web Speech API — not in Firefox/Safari).
- [ ] Dev server running: `npm run dev` → open **http://localhost:3000**
- [ ] Confirm 4 demo contacts show on the home page (Marcus, Priya, David have an **"AI profile"** badge; **Sarah Chen does not** — she's our live-generation moment).
- [ ] Allow **microphone** permission when the browser prompts (do one practice click of 🎤 Dictate so the permission dialog is already handled).
- [ ] Data is live in **Supabase** — you can open the Supabase Table Editor in another tab to prove it's real cloud data if asked.

---

## The walkthrough

### 1. The hook (15 sec)
> "Everyone has a network worth millions in opportunities — and a contacts list that's a
> graveyard. The problem was never storage. It's that capturing and *using* relationships is
> too much work. Here's how Networky removes that friction."

### 2. Frictionless capture — the data-entry-burden killer (90 sec)
This is the most important part — it directly answers Meny's likely first objection ("people
won't enter data").

1. Click **+ Add contact**. The **✨ AI assist** box appears.
2. Click **🎤 Dictate** and say (or read) something natural, like:
   > *"Met Elena Vasquez at Web Summit, she's Director of Partnerships at Brightwave in Lisbon,
   > big on climate tech and B2B SaaS, intro'd by Tom."*
3. Click **Extract details →**. Watch the AI **populate every field** — name, title, company,
   location, tags, how-we-met — from one spoken sentence.
4. Tweak anything if needed, click **Save contact**.

> "No forms. You just *talk*, and the AI structures it. That's the difference between a CRM
> people abandon and one they actually feed."

### 3. Search (20 sec)
1. In the search box, type **`fintech`** → Sarah Chen surfaces.
> "Search spans names, companies, titles, and tags — find anyone by how you *think* about them."

### 4. Notes + voice (40 sec)
1. Open **Sarah Chen**.
2. In **Notes**, click **🎤 Dictate**, say a quick note (*"Reconnected at the conference, still
   raising for the payments fund"*), and **Add note**. It's tagged **🎤 voice**.
> "Every interaction gets logged in seconds — by voice, on the go."

### 5. The payoff — AI Profile generated LIVE (90 sec)
Still on **Sarah Chen** (she has no profile yet — this is the wow moment):
1. Click **Generate** on the **AI Profile** panel.
2. In a couple seconds it produces a structured brief: **Summary, Background, Interests,
   Opportunities, Suggested Follow-Ups** — including the concrete intro ("connect her with the
   Plaid alum") pulled from the notes.

> "*This* is the product. It read her details and our notes and told us **what to do next** —
> who to introduce, what the opportunity is. That's relationship intelligence, not record-keeping."

3. (Optional) Click into **Marcus / Priya / David** to show pre-generated profiles — proof it
   works across different relationship types (recruiter, founder, enterprise BD).

### 6. Close (20 sec)
> "Phase 1 proves the core loop: capture by voice, enrich with AI, and surface the next action.
> Built today on a real cloud stack — Next.js, Supabase, OpenAI. Next we layer on the
> introduction-matching engine across the whole network, plus reminders and team workspaces."

---

## If asked / backup answers

- **"Is this real or mocked?"** — Fully live: data in Supabase Postgres, profiles + extraction
  from OpenAI (gpt-4o-mini) in real time. Open the Supabase dashboard to show the rows.
- **"What about voice if the mic fails?"** — Every voice feature also accepts typed text; just
  type into the same box. (Have this ready as the fallback if STT misbehaves on the day.)
- **"What's NOT in Phase 1?"** — The cross-network matching/introductions engine, reminders/
  birthdays, team workspaces, dashboard. Deliberately scoped out to validate the core loop first.
- **"Security / multi-user?"** — Supabase Auth (per-user scoping) is the next addition; the DB
  is already on Supabase so it's additive, not a rebuild.

## Reset between rehearsals
To get back to a clean 4-contact state (removes any test contacts you added, regenerates seed):
re-run the seed is additive, so to fully reset, clear the tables in Supabase and run
`npm run db:seed`. For a quick rehearsal, just delete any test contacts you created via the UI.
