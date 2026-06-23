import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveOrCreateWorkspace } from "@/lib/workspace";

// Auth is OPTIONAL. When the Supabase env vars are absent, the app runs in
// "open mode" exactly as before — no login required, data is shared globally.
// Once the env vars are set, auth is enforced and every record is scoped to the
// signed-in user's WORKSPACE (a shared team workspace, see lib/workspace.ts), so
// teammates in the same workspace see and edit the same contacts/notes/etc.
export function authEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Returns the signed-in Supabase user (id + email), or null when not signed in /
// open mode.
async function getUser(): Promise<{ id: string; email: string } | null> {
  if (!authEnabled()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? `${user.id}@users.noreply` };
}

// Returns the signed-in Supabase user id, or null when not signed in / open mode.
export async function getUserId(): Promise<string | null> {
  return (await getUser())?.id ?? null;
}

export type OwnerScope =
  | { ok: true; userId: string | null; workspaceId: string | null } // nulls => open mode (no filtering)
  | { ok: false; response: NextResponse };

// Resolve the owner for a Route Handler:
//  - open mode  -> { ok: true, userId: null, workspaceId: null }   (don't filter)
//  - signed in  -> { ok: true, userId, workspaceId }               (filter by workspace)
//  - auth on but no session -> { ok: false, 401 }
export async function resolveOwner(): Promise<OwnerScope> {
  if (!authEnabled()) return { ok: true, userId: null, workspaceId: null };

  const user = await getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  // Resolve (or lazily create) the user's workspace. Seeded team members resolve
  // to the shared team workspace; a brand-new signup gets a private workspace.
  const { workspaceId } = await resolveOrCreateWorkspace(user.id, user.email);
  return { ok: true, userId: user.id, workspaceId };
}

// Build a Prisma `where` fragment that scopes a query to the owner's workspace.
// In open mode this is empty (matches all rows). Applies to any table with a
// `workspaceId` column (Contact, Suggestion, Relationship); Notes scope through
// their parent contact's workspaceId.
export function ownerWhere(workspaceId: string | null) {
  return workspaceId ? { workspaceId } : {};
}
