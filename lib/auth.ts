import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Auth is OPTIONAL. When the Supabase env vars are absent, the app runs in
// "open mode" exactly as before — no login required, contacts are shared.
// Once the env vars are set (and the migration is applied), auth is enforced
// and every contact is scoped to its owner's user id.
export function authEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Returns the signed-in Supabase user id, or null when not signed in / open mode.
export async function getUserId(): Promise<string | null> {
  if (!authEnabled()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export type OwnerScope =
  | { ok: true; userId: string | null } // userId null => open mode (no filtering)
  | { ok: false; response: NextResponse };

// Resolve the owner for a Route Handler:
//  - open mode  -> { ok: true, userId: null }   (don't filter by user)
//  - signed in  -> { ok: true, userId }
//  - auth on but no session -> { ok: false, 401 }
export async function resolveOwner(): Promise<OwnerScope> {
  if (!authEnabled()) return { ok: true, userId: null };

  const userId = await getUserId();
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, userId };
}

// Build a Prisma `where` fragment that scopes a query to the owner.
// In open mode this is empty (matches all rows).
export function ownerWhere(userId: string | null) {
  return userId ? { userId } : {};
}
