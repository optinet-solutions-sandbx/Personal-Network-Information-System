# Sub-project 1: Auth + User + Personal Workspace

**Date:** 2026-06-19
**Epic:** Team Workspaces & Referral Tracking
**Status:** Approved, ready for implementation

---

## Context

This is sub-project 1 of a 4-part epic. It establishes the authentication foundation and personal workspace model that all subsequent sub-projects depend on.

**Current state:** The app has no authentication. All contacts are globally accessible with no user scoping. There is no User, Workspace, or WorkspaceMember model in the schema.

**Subsequent sub-projects (not in scope here):**
- Sub-project 2: Team Workspaces + Contact Scoping
- Sub-project 3: Membership, Roles & Invites
- Sub-project 4: Referral Tracking (user acquisition + contact network)

---

## Approach

**Supabase Auth + Prisma + Next.js middleware workspace context.**

Supabase Auth manages sessions and JWTs. A Prisma `User` record links to the Supabase auth UUID. A Next.js middleware resolves the active workspace once per request and injects `x-user-id` / `x-workspace-id` headers so all routes and server components can scope their Prisma queries without per-route auth logic.

---

## Schema Design

### New: `User` model

The `id` is the Supabase auth UUID — no separate sync column needed.

```prisma
model User {
  id        String   @id  // = Supabase auth.users UUID
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  memberships WorkspaceMember[]
}
```

### New: `Workspace` model

The container that owns contacts. `type` distinguishes personal (one per user, auto-created) from team workspaces (sub-project 2).

```prisma
model Workspace {
  id        String        @id @default(cuid())
  name      String
  type      WorkspaceType @default(personal)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  members  WorkspaceMember[]
  contacts Contact[]
}

enum WorkspaceType {
  personal
  team
}
```

### New: `WorkspaceMember` join table

Ties a user to a workspace with a role. A user's personal workspace always gives them the `owner` role.

```prisma
model WorkspaceMember {
  id          String     @id @default(cuid())
  userId      String
  workspaceId String
  role        MemberRole @default(member)
  createdAt   DateTime   @default(now())

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId])
  @@index([userId])
}

enum MemberRole {
  owner
  admin
  member
}
```

### Updated: `Contact` model

Adds a required `workspaceId` foreign key. All contacts are scoped to exactly one workspace.

```prisma
model Contact {
  // ... all existing fields unchanged ...
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  // existing indexes preserved
}
```

---

## Auth Flow

### Signup
1. User visits `/signup`, submits name + email + password
2. App calls `supabase.auth.signUp()` — Supabase creates the auth record and (in production) sends a confirmation email
3. On confirmation (or immediately in dev with email confirm disabled), Supabase sets a session JWT cookie
4. First authenticated request hits middleware → no Prisma `User` found for this UUID → middleware runs a single Prisma transaction:
   - Create `User` (id = Supabase UUID, email, name)
   - Create `Workspace` (name: "{name}'s Workspace", type: personal)
   - Create `WorkspaceMember` (role: owner)
5. Middleware injects headers → user lands on `/` (home)

### Login
1. User visits `/login`, submits email + password
2. App calls `supabase.auth.signInWithPassword()` — Supabase sets the session cookie
3. Middleware resolves existing User + personal Workspace via indexed DB lookup → injects headers → user lands on `/`

### Session lifecycle
- JWT lives in an httpOnly cookie managed by `@supabase/ssr`
- Middleware refreshes the JWT automatically when close to expiry
- Signout calls `supabase.auth.signOut()`, clears the cookie, redirects to `/login`

---

## Middleware

`middleware.ts` at the project root. Runs on every request except `/login`, `/signup`, and `/api/auth/*`.

**Steps per request:**
1. Read + refresh JWT from cookies via `@supabase/ssr` — if invalid/missing, redirect to `/login`
2. Extract Supabase user UUID from the validated JWT (no extra network call)
3. Query Prisma: `WorkspaceMember.findFirst({ where: { userId, workspace: { type: 'personal' } }, select: { workspaceId: true } })`
4. If no record → first-time user → run create transaction using `upsert` semantics to handle the edge case where two simultaneous first requests race (the `@@unique([userId, workspaceId])` constraint ensures only one workspace is created; the losing request reads the winner's record)
5. Set `x-user-id` and `x-workspace-id` on the request headers
6. Pass through with enriched headers

**How routes consume it:**
```ts
// Any API route or server component:
const userId = request.headers.get('x-user-id')
const workspaceId = request.headers.get('x-workspace-id')
// All Prisma queries include: where: { workspaceId }
```

**Performance:** One indexed DB query per request (`WorkspaceMember` indexed on `userId`). Acceptable at this scale. Future optimization: embed `workspaceId` in a signed cookie to skip the lookup on cached requests.

---

## UI

### `/login`
Email + password form. On success → redirect to `/`. On failure → inline Supabase error message. Link to `/signup`.

### `/signup`
Name + email + password form. On success:
- Dev (email confirm disabled): redirect to `/`
- Prod (email confirm enabled): show "Check your email" message, no redirect

### Signout
Button at the bottom of the existing `ContactsSidebar` component. Calls `supabase.auth.signOut()` → redirect to `/login`.

### Existing pages
No changes. Middleware handles protection transparently — unauthenticated users are redirected to `/login` before reaching any existing route.

### Out of scope for sub-project 1
- Password reset (Supabase supports this natively; add as a small follow-up)
- Social/OAuth login (can be enabled in Supabase dashboard with minimal code changes later)

---

## Migration

**All existing Contact and Note rows are wiped.** This is pre-launch development data on `dev-leo` — no real user data is at risk. Starting fresh is cleaner than backfilling orphaned rows.

**Prisma migration steps (in order):**
```sql
-- 1. Clear orphaned dev data
TRUNCATE "Note", "Contact" CASCADE;

-- 2. Create new tables
CREATE TABLE "User" (...);
CREATE TABLE "Workspace" (...);
CREATE TABLE "WorkspaceMember" (...);

-- 3. Add workspaceId to Contact (now safe — table is empty)
ALTER TABLE "Contact" ADD COLUMN "workspaceId" TEXT NOT NULL
  REFERENCES "Workspace"("id") ON DELETE CASCADE;
```

In a future production migration with real data, the approach would be: create a system workspace, backfill existing contacts into it, then re-attribute contacts as users sign in. That complexity is not warranted here.

---

## Dependencies

**New packages:**
- `@supabase/ssr` — cookie-based session management for Next.js (replaces `@supabase/auth-helpers-nextjs` which is deprecated)
- `@supabase/supabase-js` — Supabase client (likely already installed; verify)

**Supabase dashboard config:**
- Enable email + password auth
- Set site URL and redirect URLs for the Vercel deployment
- Disable email confirmation for local dev; enable for production

---

## What Sub-project 2 Builds On

After this sub-project ships:
- Every contact is scoped to a `workspaceId`
- Every request carries `x-user-id` and `x-workspace-id` headers
- The `WorkspaceMember` table exists and is ready to support team workspaces
- Sub-project 2 adds team workspace creation, switching, and scoping contacts across multiple workspaces
