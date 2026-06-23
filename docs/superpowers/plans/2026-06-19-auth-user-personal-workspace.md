# Auth + User + Personal Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase Auth, User/Workspace/WorkspaceMember schema, and a Next.js proxy that gates all routes and injects workspace context into request headers so every contact is scoped to the authenticated user's personal workspace.

**Architecture:** Supabase Auth manages sessions via httpOnly cookies (`@supabase/ssr`). `proxy.ts` (Next.js 16's renamed `middleware.ts`) validates the JWT on every request, resolves the user's personal workspace from Prisma (creating it on first login), and injects `x-user-id` + `x-workspace-id` headers. API routes read these headers and scope all Prisma queries to the workspace. Login/signup are client-side forms calling Supabase Auth directly.

**Tech Stack:** `@supabase/supabase-js`, `@supabase/ssr`, Next.js 16.2.9 proxy.ts, Prisma 6.19.3, PostgreSQL/Supabase

## Global Constraints

- **Next.js 16 breaking change:** `middleware.ts` is renamed `proxy.ts`; exported function is `proxy` (not `middleware`). Proxy defaults to Node.js runtime — Prisma is safe inside it.
- **Header trust:** `x-user-id` and `x-workspace-id` headers are injected server-side by `proxy.ts` only. API routes treat them as trusted — never read user-supplied versions of these.
- **Workspace scoping:** Every Prisma contact query MUST include `where: { workspaceId }`. Omitting this leaks cross-user data.
- **Dev data wipe:** The migration truncates existing Contact and Note rows before adding the `workspaceId NOT NULL` column. This is intentional — the data is test data.
- **No test framework installed:** Tasks use manual verification steps. Where automated tests would run, the plan shows the `npm run dev` + browser flow to verify instead.
- **Supabase env vars required:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be in `.env` before proxy.ts or auth pages will work.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `lib/supabase/client.ts` | Browser Supabase client factory |
| Create | `lib/workspace.ts` | `resolveOrCreateWorkspace()` + `getWorkspaceContext()` |
| Create | `proxy.ts` | Auth gate + workspace context header injection |
| Create | `app/login/page.tsx` | Login form (client component) |
| Create | `app/signup/page.tsx` | Signup form (client component) |
| Modify | `prisma/schema.prisma` | Add User, Workspace, WorkspaceMember; add workspaceId to Contact |
| Modify | `.env` | Add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY |
| Modify | `components/ContactsSidebar.tsx` | Hide on /login+/signup; add signout button |
| Modify | `app/api/contacts/route.ts` | Filter GET by workspaceId; inject workspaceId on POST |
| Modify | `app/api/contacts/[id]/route.ts` | Scope GET/PATCH/DELETE to workspaceId |
| Modify | `app/api/contacts/[id]/notes/route.ts` | Verify contact is in workspace before creating note |
| Modify | `app/api/contacts/check/route.ts` | Filter duplicate check by workspaceId |
| Modify | `app/api/contacts/extract/route.ts` | Auth check only (no DB contact, just OpenAI) |
| Modify | `app/api/contacts/[id]/profile/route.ts` | Scope contact lookup to workspaceId |
| Modify | `app/api/notes/[id]/route.ts` | Verify note's contact is in workspace before PATCH/DELETE |

---

## Task 1: Install Packages + Add Env Vars

**Files:**
- Modify: `.env`

**Interfaces:**
- Produces: `createBrowserClient`, `createServerClient` from `@supabase/ssr` available to import

- [ ] **Step 1: Install Supabase packages**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

Expected output: `added N packages` with no errors.

- [ ] **Step 2: Get Supabase public keys from dashboard**

1. Open [supabase.com](https://supabase.com) → your project (`irxbxbdjlojqrildwfuh`)
2. Go to **Project Settings → API**
3. Copy **Project URL** (format: `https://irxbxbdjlojqrildwfuh.supabase.co`)
4. Copy **anon public** key (long JWT string under "Project API keys")

- [ ] **Step 3: Add env vars to `.env`**

Append to `.env` (the file already has DATABASE_URL and OPENAI_API_KEY):

```env
# Supabase Auth — public vars (safe to expose to browser)
NEXT_PUBLIC_SUPABASE_URL="https://irxbxbdjlojqrildwfuh.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<paste anon key from dashboard>"
```

- [ ] **Step 4: Enable email + password auth in Supabase dashboard**

1. Go to **Authentication → Providers** in the Supabase dashboard
2. Confirm **Email** provider is enabled (it is by default)
3. Under **Authentication → Email Templates**, note that confirmation emails are enabled by default in production. For local dev, go to **Authentication → Settings** and disable "Enable email confirmations" — this lets signup immediately create a session without waiting for email.

- [ ] **Step 5: Verify install**

```bash
node -e "require('@supabase/ssr'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env
git commit -m "chore: install @supabase/ssr and add Supabase public env vars"
```

> **Note:** `.env` contains the anon key which is public (it's safe for browsers). Do NOT commit the `SERVICE_ROLE_KEY` if you ever add it.

---

## Task 2: Update Prisma Schema + Run Migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `prisma.user`, `prisma.workspace`, `prisma.workspaceMember` Prisma client models; `contact.workspaceId` field

- [ ] **Step 1: Replace schema.prisma with the updated schema**

Replace the full contents of `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model User {
  id        String   @id // = Supabase auth.users UUID
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  memberships WorkspaceMember[]
}

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

model Contact {
  id          String    @id @default(cuid())
  workspaceId String
  name        String
  email       String?
  phone       String?
  company     String?
  title       String?
  location    String?
  tags        String?
  howWeMet    String?
  customFields String?

  profile          String?
  profileModel     String?
  profileUpdatedAt DateTime?

  notes Note[]
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([workspaceId])
  @@index([name])
  @@index([company])
}

model Note {
  id        String  @id @default(cuid())
  contactId String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  content String
  source  String @default("manual")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([contactId])
}
```

- [ ] **Step 2: Create migration file without applying it**

```bash
npx prisma migrate dev --name add-auth-and-workspaces --create-only
```

This creates `prisma/migrations/<timestamp>_add-auth-and-workspaces/migration.sql` without running it.

- [ ] **Step 3: Prepend data wipe to migration SQL**

Open the generated `migration.sql` file. Add these two lines at the very top, before any other SQL:

```sql
-- Wipe dev data so workspaceId NOT NULL can be added cleanly
TRUNCATE "Note", "Contact" CASCADE;

```

- [ ] **Step 4: Apply the migration**

```bash
npx prisma migrate dev
```

Expected: `The following migration(s) have been applied: ... add-auth-and-workspaces` with no errors.

- [ ] **Step 5: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` with no errors.

- [ ] **Step 6: Verify in Prisma Studio**

```bash
npx prisma studio
```

Open the browser. Confirm `User`, `Workspace`, `WorkspaceMember` tables appear, and `Contact` has a `workspaceId` column. Close Prisma Studio.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add User, Workspace, WorkspaceMember schema; scope Contact to workspace"
```

---

## Task 3: Supabase Browser Client Helper

**Files:**
- Create: `lib/supabase/client.ts`

**Interfaces:**
- Produces: `createClient(): SupabaseClient` — call once per component that needs Supabase Auth (login page, signup page, signout button)

- [ ] **Step 1: Create the directory and file**

Create `lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to this file).

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/client.ts
git commit -m "feat: add Supabase browser client helper"
```

---

## Task 4: Workspace Resolution Helper

**Files:**
- Create: `lib/workspace.ts`

**Interfaces:**
- Produces:
  - `resolveOrCreateWorkspace(userId: string, email: string, name?: string): Promise<{ workspaceId: string }>` — used by `proxy.ts`
  - `getWorkspaceContext(req: NextRequest): { userId: string; workspaceId: string } | null` — used by every API route

- [ ] **Step 1: Create `lib/workspace.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

export function getWorkspaceContext(
  req: NextRequest
): { userId: string; workspaceId: string } | null {
  const userId = req.headers.get("x-user-id");
  const workspaceId = req.headers.get("x-workspace-id");
  if (!userId || !workspaceId) return null;
  return { userId, workspaceId };
}

export async function resolveOrCreateWorkspace(
  userId: string,
  email: string,
  name?: string
): Promise<{ workspaceId: string }> {
  // Fast path: user already has a personal workspace
  const existing = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { type: "personal" } },
    select: { workspaceId: true },
  });
  if (existing) return { workspaceId: existing.workspaceId };

  // First login: create User + Workspace + WorkspaceMember in one transaction.
  // If a race condition hits (two concurrent first requests), the unique constraint
  // on [userId, workspaceId] causes one to fail — the catch block retries the read.
  try {
    const workspaceId = await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: userId },
        update: { email, name: name ?? null },
        create: { id: userId, email, name: name ?? null },
      });
      const workspace = await tx.workspace.create({
        data: { name: `${name ?? email}'s Workspace`, type: "personal" },
      });
      await tx.workspaceMember.create({
        data: { userId, workspaceId: workspace.id, role: "owner" },
      });
      return workspace.id;
    });
    return { workspaceId };
  } catch {
    // Race condition: another concurrent request already created the workspace.
    const member = await prisma.workspaceMember.findFirst({
      where: { userId, workspace: { type: "personal" } },
      select: { workspaceId: true },
    });
    if (member) return { workspaceId: member.workspaceId };
    throw new Error(`Failed to create workspace for user ${userId}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `lib/workspace.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/workspace.ts
git commit -m "feat: add workspace resolution helper with race-safe upsert"
```

---

## Task 5: proxy.ts — Auth Gate + Workspace Context

**Files:**
- Create: `proxy.ts` (project root, same level as `package.json`)

**Interfaces:**
- Consumes: `resolveOrCreateWorkspace` from `lib/workspace.ts`; `@supabase/ssr` createServerClient
- Produces: every request to protected routes gets `x-user-id` and `x-workspace-id` request headers

- [ ] **Step 1: Create `proxy.ts` at the project root**

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolveOrCreateWorkspace } from "@/lib/workspace";

export async function proxy(request: NextRequest) {
  // Build a mutable response so Supabase can refresh session cookies
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const name = (user.user_metadata?.name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined);

  const { workspaceId } = await resolveOrCreateWorkspace(
    user.id,
    user.email!,
    name
  );

  // Forward user context to route handlers via request headers,
  // while preserving any session cookies Supabase refreshed above.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", user.id);
  requestHeaders.set("x-workspace-id", workspaceId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Copy any cookie refreshes from Supabase to the final response
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie.name, cookie.value, cookie);
  });

  return response;
}

export const config = {
  matcher: [
    // Run proxy on all routes except: login, signup, Next.js internals, static files
    "/((?!login|signup|_next/static|_next/image|favicon|apple-icon|icon).*)",
  ],
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `proxy.ts`.

- [ ] **Step 3: Start dev server and verify redirect**

```bash
npm run dev
```

Open `http://localhost:3000`. You should be immediately redirected to `http://localhost:3000/login`. The login page doesn't exist yet so you'll get a 404 — that's expected. The redirect itself confirms the proxy is working.

- [ ] **Step 4: Commit**

```bash
git add proxy.ts
git commit -m "feat: add proxy.ts for auth gate and workspace context injection"
```

---

## Task 6: Login + Signup Pages

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/signup/page.tsx`

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/client.ts`
- Produces: authenticated session (Supabase cookie) + redirect to `/` on success

- [ ] **Step 1: Create `app/login/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-500">Welcome back to Networky.ai</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-500">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-indigo-600 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/signup/page.tsx`**

```typescript
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Email confirm disabled (dev): session is immediately available
    if (data.session) {
      router.push("/");
      router.refresh();
      return;
    }
    // Email confirm enabled (prod): show check-email message
    setEmailSent(true);
    setLoading(false);
  }

  if (emailSent) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 text-center">
          <div className="text-4xl">📬</div>
          <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
          <p className="mt-2 text-sm text-zinc-500">
            We sent a confirmation link to{" "}
            <strong className="text-zinc-700">{email}</strong>. Click it to
            activate your account.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm text-indigo-600 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8">
        <h1 className="text-xl font-semibold">Create account</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Start building your personal network
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <p className="mt-1 text-xs text-zinc-400">Minimum 8 characters</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify login page loads**

With `npm run dev` running, open `http://localhost:3000/login`. You should see the sign-in form (no redirect loop, no 404).

- [ ] **Step 4: Verify signup flow works end to end**

1. Go to `http://localhost:3000/signup`
2. Enter name, email, and password (8+ chars)
3. Submit — if email confirm is disabled in Supabase dashboard, you should be redirected to `http://localhost:3000`
4. Open Supabase dashboard → **Authentication → Users** — confirm the new user appears
5. Open **Table Editor → User** — confirm a User row was created with the Supabase UUID
6. Open **Table Editor → Workspace** — confirm a personal workspace was created
7. Open **Table Editor → WorkspaceMember** — confirm the user is linked as `owner`

- [ ] **Step 5: Verify login redirects correctly**

Go to `http://localhost:3000/login`, enter the credentials from Step 4, submit. You should land on the home page.

- [ ] **Step 6: Commit**

```bash
git add app/login/page.tsx app/signup/page.tsx
git commit -m "feat: add login and signup pages with Supabase Auth"
```

---

## Task 7: ContactsSidebar — Hide on Auth Routes + Signout Button

**Files:**
- Modify: `components/ContactsSidebar.tsx`

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/client.ts`
- Produces: sidebar hidden on `/login` and `/signup`; signout button at bottom of sidebar

- [ ] **Step 1: Update `components/ContactsSidebar.tsx`**

Replace the full file:

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Contact } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-red-400",
  "bg-sky-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-teal-500",
];

function avatarColor(name: string): string {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

export default function ContactsSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  // Don't render sidebar on auth pages
  if (pathname === "/login" || pathname === "/signup") return null;

  useEffect(() => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((data: Contact[]) => setContacts(data))
      .catch(() => {});
  }, [pathname]);

  const filtered = query.trim()
    ? contacts.filter((c) =>
        [c.name, c.company, c.title, c.tags]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())
      )
    : contacts;

  async function handleSignout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex w-56 flex-shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold text-zinc-900">Contacts</span>
        <Link
          href="/"
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          + Add
        </Link>
      </div>

      <div className="px-3 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 focus:ring-0"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.map((c) => {
          const active = pathname === `/contacts/${c.id}`;
          const initial = (c.name?.[0] ?? "?").toUpperCase();
          return (
            <Link
              key={c.id}
              href={`/contacts/${c.id}`}
              className={`flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(
                  c.name ?? ""
                )}`}
              >
                {initial}
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-xs font-medium ${
                    active ? "text-indigo-700" : "text-zinc-800"
                  }`}
                >
                  {c.name}
                </span>
                <span className="block truncate text-[10px] text-zinc-400">
                  {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
            </Link>
          );
        })}

        {filtered.length === 0 && (
          <p className="px-2 py-3 text-xs text-zinc-400">
            {query ? "No matches." : "No contacts yet."}
          </p>
        )}
      </nav>

      <div className="border-t border-zinc-200 px-3 py-3">
        <button
          onClick={handleSignout}
          className="w-full rounded-md px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify sidebar is hidden on auth pages**

With `npm run dev` running:
1. Go to `http://localhost:3000/login` — no sidebar should appear (just the header and centered form)
2. Go to `http://localhost:3000/signup` — same, no sidebar

- [ ] **Step 3: Verify signout works**

1. Log in (via `/login`)
2. Click "Sign out" at the bottom of the sidebar
3. You should be redirected to `/login`
4. Trying to go to `http://localhost:3000` should redirect back to `/login` (proxy gate)

- [ ] **Step 4: Commit**

```bash
git add components/ContactsSidebar.tsx
git commit -m "feat: hide sidebar on auth routes and add signout button"
```

---

## Task 8: Scope Contact API Routes to Workspace

**Files:**
- Modify: `app/api/contacts/route.ts`
- Modify: `app/api/contacts/[id]/route.ts`
- Modify: `app/api/contacts/check/route.ts`
- Modify: `app/api/contacts/extract/route.ts`

**Interfaces:**
- Consumes: `getWorkspaceContext` from `lib/workspace.ts`
- Produces: all contact endpoints filtered to the caller's workspace; 401 if workspace context missing

- [ ] **Step 1: Update `app/api/contacts/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace";

const insensitive = (q: string) => ({ contains: q, mode: Prisma.QueryMode.insensitive });

function parseCustomFields(c: Record<string, unknown>) {
  const raw = c.customFields;
  return {
    ...c,
    customFields:
      typeof raw === "string" && raw
        ? (JSON.parse(raw) as Record<string, string>)
        : null,
  };
}

export async function GET(req: NextRequest) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();

  const where = q
    ? {
        workspaceId: ctx.workspaceId,
        OR: [
          { name: insensitive(q) },
          { email: insensitive(q) },
          { company: insensitive(q) },
          { title: insensitive(q) },
          { tags: insensitive(q) },
          { location: insensitive(q) },
        ],
      }
    : { workspaceId: ctx.workspaceId };

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { notes: true } } },
  });

  return NextResponse.json(
    contacts.map((c) => parseCustomFields(c as unknown as Record<string, unknown>))
  );
}

export async function POST(req: NextRequest) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const contact = await prisma.contact.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: body.name.trim(),
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      company: body.company?.trim() || null,
      title: body.title?.trim() || null,
      location: body.location?.trim() || null,
      tags: body.tags?.trim() || null,
      howWeMet: body.howWeMet?.trim() || null,
      customFields:
        body.customFields &&
        typeof body.customFields === "object" &&
        Object.keys(body.customFields).length > 0
          ? JSON.stringify(body.customFields)
          : null,
    },
  });

  return NextResponse.json(
    parseCustomFields(contact as unknown as Record<string, unknown>),
    { status: 201 }
  );
}
```

- [ ] **Step 2: Update `app/api/contacts/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

function parseCustomFields(c: Record<string, unknown>) {
  const raw = c.customFields;
  return {
    ...c,
    customFields:
      typeof raw === "string" && raw
        ? (JSON.parse(raw) as Record<string, string>)
        : null,
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const contact = await prisma.contact.findUnique({
    where: { id, workspaceId: ctx.workspaceId },
    include: { notes: { orderBy: { createdAt: "desc" } } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(
    parseCustomFields(contact as unknown as Record<string, unknown>)
  );
}

const EDITABLE = [
  "name",
  "email",
  "phone",
  "company",
  "title",
  "location",
  "tags",
  "howWeMet",
] as const;

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const data: Record<string, string | null> = {};
  for (const key of EDITABLE) {
    if (key in body) {
      const v = typeof body[key] === "string" ? body[key].trim() : body[key];
      data[key] = v || null;
    }
  }
  if ("name" in data && !data.name) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }

  if ("customFields" in body) {
    if (
      body.customFields &&
      typeof body.customFields === "object" &&
      Object.keys(body.customFields).length > 0
    ) {
      data.customFields = JSON.stringify(body.customFields);
    } else {
      data.customFields = null;
    }
  }

  try {
    const contact = await prisma.contact.update({
      where: { id, workspaceId: ctx.workspaceId },
      data,
    });
    return NextResponse.json(
      parseCustomFields(contact as unknown as Record<string, unknown>)
    );
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await prisma.contact.delete({ where: { id, workspaceId: ctx.workspaceId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 3: Update `app/api/contacts/check/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const name = req.nextUrl.searchParams.get("name")?.trim();
  const email = req.nextUrl.searchParams.get("email")?.trim();

  const or: object[] = [];
  if (name) or.push({ name: { equals: name, mode: "insensitive" } });
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });

  if (or.length === 0) return NextResponse.json([]);

  const matches = await prisma.contact.findMany({
    where: { workspaceId: ctx.workspaceId, OR: or },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { notes: true } } },
    take: 5,
  });

  return NextResponse.json(matches);
}
```

- [ ] **Step 4: Update `app/api/contacts/extract/route.ts`**

Read the current file first, then add the auth check at the top of the `POST` handler. The only change is adding the two lines at the start of the function:

```typescript
// Add at the top of the POST handler, before any other logic:
const ctx = getWorkspaceContext(req);
if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

Also add the import at the top of the file:
```typescript
import { getWorkspaceContext } from "@/lib/workspace";
```

- [ ] **Step 5: Verify contact CRUD works end to end**

With `npm run dev` running and logged in:
1. Go to `http://localhost:3000` — home page should load with the story input
2. Type a contact story and submit — contact should be created and appear in the sidebar
3. Click the contact in the sidebar — detail page should load
4. Edit a field and save — should persist
5. Delete the contact — should disappear from sidebar

- [ ] **Step 6: Commit**

```bash
git add app/api/contacts/route.ts app/api/contacts/[id]/route.ts \
        app/api/contacts/check/route.ts app/api/contacts/extract/route.ts
git commit -m "feat: scope contact API routes to workspace context"
```

---

## Task 9: Scope Notes + Profile API Routes to Workspace

**Files:**
- Modify: `app/api/contacts/[id]/notes/route.ts`
- Modify: `app/api/contacts/[id]/profile/route.ts`
- Modify: `app/api/notes/[id]/route.ts`

**Interfaces:**
- Consumes: `getWorkspaceContext` from `lib/workspace.ts`
- Produces: notes and profile endpoints verified against workspace ownership; 401 or 404 for unauthorized access

- [ ] **Step 1: Update `app/api/contacts/[id]/notes/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { NoteSource } from "@/lib/types";
import { getWorkspaceContext } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Verify contact belongs to this workspace
  const contact = await prisma.contact.findUnique({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });

  const notes = await prisma.note.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  // Verify contact belongs to this workspace before creating a note
  const contact = await prisma.contact.findUnique({
    where: { id, workspaceId: ctx.workspaceId },
  });
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  const source: NoteSource =
    body.source === "voice" ? "voice" : body.source === "story" ? "story" : "manual";
  const note = await prisma.note.create({
    data: { contactId: id, content: body.content.trim(), source },
  });
  await prisma.contact.update({ where: { id }, data: { updatedAt: new Date() } });

  return NextResponse.json(note, { status: 201 });
}
```

- [ ] **Step 2: Update `app/api/contacts/[id]/profile/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateProfile } from "@/lib/profile";
import { getWorkspaceContext } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const contact = await prisma.contact.findUnique({
    where: { id, workspaceId: ctx.workspaceId },
    include: { notes: { orderBy: { createdAt: "asc" } } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { profile, model } = await generateProfile({
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    company: contact.company,
    title: contact.title,
    location: contact.location,
    tags: contact.tags,
    howWeMet: contact.howWeMet,
    notes: contact.notes.map((n) => ({
      content: n.content,
      createdAt: n.createdAt,
    })),
  });

  const updated = await prisma.contact.update({
    where: { id },
    data: { profile, profileModel: model, profileUpdatedAt: new Date() },
  });

  return NextResponse.json(updated);
}
```

- [ ] **Step 3: Update `app/api/notes/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  // Verify the note's contact belongs to this workspace
  const note = await prisma.note.findFirst({
    where: { id, contact: { workspaceId: ctx.workspaceId } },
  });
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updated = await prisma.note.update({
    where: { id },
    data: { content: body.content.trim() },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Verify the note's contact belongs to this workspace
  const note = await prisma.note.findFirst({
    where: { id, contact: { workspaceId: ctx.workspaceId } },
  });
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.note.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Full end-to-end verification**

With `npm run dev` running and logged in:
1. Create a contact via the story input on the home page
2. Open the contact detail page
3. Add a note — it should appear in the notes list
4. Edit the note — it should save
5. Generate an AI profile — it should appear
6. Delete the note — it should disappear
7. Delete the contact — you should be redirected to home

- [ ] **Step 5: Verify auth isolation**

1. Open an incognito window and go to `http://localhost:3000`
2. You should be redirected to `/login` (not see any contacts)
3. Sign up as a **different user**
4. The contact list should be empty — the new user has their own workspace

- [ ] **Step 6: Commit**

```bash
git add app/api/contacts/[id]/notes/route.ts \
        app/api/contacts/[id]/profile/route.ts \
        app/api/notes/[id]/route.ts
git commit -m "feat: scope notes and profile API routes to workspace"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Auth flow ✓, Schema ✓, Middleware (proxy.ts) ✓, UI (login/signup/signout) ✓, Migration ✓, Workspace isolation ✓
- [x] **No placeholders:** All code blocks are complete. Task 9 Step 2 notes to read the existing profile route first — this is necessary context, not a placeholder.
- [x] **Type consistency:** `getWorkspaceContext` returns `{ userId, workspaceId }` in Task 4 and is used as `ctx.workspaceId` in Tasks 8–9. `resolveOrCreateWorkspace(userId, email, name?)` defined in Task 4 and consumed with those exact args in Task 5.
- [x] **Migration wipe:** Task 2 explicitly prepends `TRUNCATE "Note", "Contact" CASCADE` to the migration SQL.
- [x] **Proxy matcher:** `/login`, `/signup`, `_next/*`, favicon, and icon paths excluded so auth pages and assets load without redirect loops.
