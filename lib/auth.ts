import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { MemberRole } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { membershipRole, resolveOrCreateWorkspace } from "@/lib/workspace";

// Cookie holding the user's currently-selected workspace id. Read here to scope
// every query server-side; set by POST /api/workspaces/switch. Persisting it as
// a cookie also satisfies "remember the last selected workspace" across reloads.
export const WORKSPACE_COOKIE = "networky:workspace";

// Auth is OPTIONAL. When the Supabase env vars are absent, the app runs in
// "open mode" exactly as before — no login required, data is shared globally.
// Once the env vars are set, auth is enforced and every record is scoped to the
// signed-in user's own PERSONAL workspace (see lib/workspace.ts), so each
// account has its own private contacts/notes/etc. — nothing is shared between
// accounts.
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
  | {
      ok: true;
      userId: string | null;
      workspaceId: string | null; // nulls => open mode (no filtering)
      role: MemberRole | null; // the user's role in the resolved workspace (null in open mode)
    }
  | { ok: false; response: NextResponse };

// Resolve the owner for a Route Handler:
//  - open mode  -> { ok: true, userId: null, workspaceId: null }   (don't filter)
//  - signed in  -> { ok: true, userId, workspaceId, role }         (filter by workspace)
//  - auth on but no session -> { ok: false, 401 }
//
// The resolved workspace is the one selected via the WORKSPACE_COOKIE when the
// user is a member of it; otherwise it falls back to their personal workspace.
// This makes a stale/revoked cookie degrade gracefully (no error) and is what
// lets the sidebar switcher re-scope every route just by setting the cookie.
export async function resolveOwner(): Promise<OwnerScope> {
  if (!authEnabled())
    return { ok: true, userId: null, workspaceId: null, role: null };

  const user = await getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  // Always ensure the personal workspace exists — it's the guaranteed fallback.
  const { workspaceId: personalId } = await resolveOrCreateWorkspace(
    user.id,
    user.email
  );

  // Honor the selected-workspace cookie only if the user is actually a member.
  const selected = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  if (selected && selected !== personalId) {
    const role = await membershipRole(user.id, selected);
    if (role) return { ok: true, userId: user.id, workspaceId: selected, role };
  }

  // Fallback: the personal workspace (the user is always its owner).
  return { ok: true, userId: user.id, workspaceId: personalId, role: "owner" };
}

// One year, in seconds — the selected-workspace cookie's lifetime.
const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Set the selected-workspace cookie (used by the switcher and by accepting an
// invite). httpOnly: the client never needs to read it — the current selection
// comes back from resolveOwner via /api/workspaces.
export async function setWorkspaceSelection(workspaceId: string): Promise<void> {
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    sameSite: "lax",
    maxAge: WORKSPACE_COOKIE_MAX_AGE,
    httpOnly: true,
  });
}

// Clear the selected-workspace cookie. Called after a user deletes or leaves
// the workspace they were in; resolveOwner then falls back to their personal
// workspace on the next request. (Even without this, resolveOwner re-checks
// membership and falls back gracefully — clearing just keeps the cookie tidy.)
export async function clearWorkspaceSelection(): Promise<void> {
  (await cookies()).delete(WORKSPACE_COOKIE);
}

// Build a Prisma `where` fragment that scopes a query to the owner's workspace.
// In open mode this is empty (matches all rows). Applies to any table with a
// `workspaceId` column (Contact, Suggestion, Relationship); Notes scope through
// their parent contact's workspaceId.
export function ownerWhere(workspaceId: string | null) {
  return workspaceId ? { workspaceId } : {};
}
