# Phase 1 hardening — setup & verification

This covers the remaining Phase 1 items: input validation, pagination, error
states, automated tests, optional Supabase Auth, and the manual STT dry-run.

All of these except auth-activation are live with no configuration. Auth ships
in a **disabled-by-default** state so nothing breaks until you opt in.

---

## What changed (no action needed)

- **Input validation** — `lib/validation.ts` enforces required name, valid email,
  per-field length caps, and custom-field limits across all contact/note routes.
- **Pagination** — `GET /api/contacts` accepts `?limit=&offset=` and returns
  `X-Total-Count` / `X-Has-More` headers. The home list and sidebar now load in
  pages with a **Load more** button; the dashboard still fetches all for stats.
- **Error states** — extraction, profile generation, save/edit/delete, and list
  loads now surface user-visible errors (SweetAlert dialogs / inline retry)
  instead of failing silently. AI/DB failures return `5xx` with a friendly message.
- **Tests** — `npm test` runs Vitest. Initial coverage is the validation layer
  (`tests/validation.test.ts`, 17 cases). Add more under `tests/`.

---

## Enabling Supabase Auth (email + password)

Today the app runs in **open mode**: no login, contacts are shared. To scope
contacts per user:

1. **Get your keys** — Supabase dashboard → Project Settings → API. Copy the
   **Project URL** and the **anon/public** key.

2. **Set env vars** (both required to activate auth):
   - Local: uncomment + fill in `.env`:
     ```
     NEXT_PUBLIC_SUPABASE_URL="https://irxbxbdjlojqrildwfuh.supabase.co"
     NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon public key>"
     ```
   - Production: add the same two vars in Vercel → Project → Settings → Environment
     Variables, then redeploy.

3. **Email provider settings** — Supabase → Authentication → Providers → Email is
   on by default. For smooth demos, consider Authentication → **disable "Confirm
   email"** so sign-up logs in immediately (otherwise users must confirm via email
   before signing in).

4. **Migration** — already applied. The `userId` column was added to `Contact`
   (migration `add_contact_user_id`) on the shared Supabase DB. Nothing to run.

5. **Existing contacts** — rows created before auth have `userId = NULL` and are
   invisible once auth is on. To claim them for your account, find your user id in
   Supabase → Authentication → Users, then run in the SQL editor:
   ```sql
   update "Contact" set "userId" = '<your-user-id>' where "userId" is null;
   ```
   For a clean demo instead: set `SEED_USER_ID=<your-user-id>` and run
   `npm run db:reset`.

### How it works
- `proxy.ts` (Next 16's renamed middleware) refreshes the session and redirects
  unauthenticated page requests to `/login`.
- API routes enforce auth themselves via `resolveOwner()` (`lib/auth.ts`),
  returning `401` when signed out and scoping every query to the owner.
- With the env vars unset, `proxy.ts` and `resolveOwner()` short-circuit to open
  mode — identical to previous behavior.

---

## Manual STT mic dry-run (do before any live demo)

Speech-to-text uses the browser-native Web Speech API — it can't be tested
headless. Run this once in the actual demo browser:

1. Open the app in **Chrome or Edge** (Web Speech API is Chromium-only; the
   Dictate button is disabled in Firefox/Safari).
2. Use `http://localhost:3000` or an **https** URL — mic access is blocked on
   non-localhost http origins.
3. On the home **Add contact** form, click **🎤 Dictate**. Approve the mic
   permission prompt when the browser asks.
4. Speak a sentence; confirm the button shows **● Listening… stop** and the
   transcribed text appears in the story box.
5. Click again to stop. Click **Extract** and confirm fields populate.
6. Repeat on a **contact detail → Notes** box (dictate a note, **Add note**,
   confirm it saves with the 🎤 voice badge).

If the button is greyed out: wrong browser. If nothing transcribes: check the
site's mic permission (address-bar icon) and the OS mic input device.
