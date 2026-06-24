import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";
import type { MemberRole, WorkspaceType } from "@prisma/client";

export function getWorkspaceContext(
  req: NextRequest
): { userId: string; workspaceId: string } | null {
  const userId = req.headers.get("x-user-id");
  const workspaceId = req.headers.get("x-workspace-id");
  if (!userId || !workspaceId) return null;
  return { userId, workspaceId };
}

export type WorkspaceSummary = {
  id: string;
  name: string;
  type: WorkspaceType;
  role: MemberRole;
  avatar: string | null;
};

// All workspaces the user is a member of, with their role in each. Ordered
// personal-first (so the user's own workspace leads the switcher) then by name.
export async function listWorkspacesForUser(
  userId: string
): Promise<WorkspaceSummary[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: {
      role: true,
      workspace: { select: { id: true, name: true, type: true, avatar: true } },
    },
  });
  return memberships
    .map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      type: m.workspace.type,
      role: m.role,
      avatar: m.workspace.avatar,
    }))
    .sort((a, b) => {
      // personal workspaces first, then alphabetical by name
      if (a.type !== b.type) return a.type === "personal" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

// The user's role in a workspace, or null if they're not a member. This is the
// authorization primitive: a non-null result means the user may access the
// workspace's data (role gating for owner/admin actions builds on top of it).
export async function membershipRole(
  userId: string,
  workspaceId: string
): Promise<MemberRole | null> {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

// Role hierarchy: owner > admin > member. `roleAtLeast(role, "admin")` is true
// for owners and admins.
const ROLE_RANK: Record<MemberRole, number> = { owner: 3, admin: 2, member: 1 };
export function roleAtLeast(role: MemberRole, min: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export type RoleGate =
  | { ok: true; role: MemberRole }
  | { ok: false; status: 401 | 403 };

// One-line authorization for workspace routes: confirms the user is a member
// with at least `min` role. Returns 403 when they're not a member or lack the
// role. (Routes pass userId from resolveOwner, which already guarantees auth.)
export async function assertWorkspaceRole(
  userId: string,
  workspaceId: string,
  min: MemberRole
): Promise<RoleGate> {
  const role = await membershipRole(userId, workspaceId);
  if (!role || !roleAtLeast(role, min)) return { ok: false, status: 403 };
  return { ok: true, role };
}

// Unguessable token for a shareable invite link (256 bits, URL-safe).
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

// A shareable invite link is usable iff it hasn't been revoked and hasn't
// expired (a null expiresAt means it never expires).
export function inviteIsValid(
  invite: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date()
): boolean {
  if (invite.revokedAt) return false;
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export async function resolveOrCreateWorkspace(
  userId: string,
  email: string,
  name?: string
): Promise<{ workspaceId: string }> {
  // Each account is scoped to its OWN PERSONAL workspace — accounts never share
  // contacts/notes/etc. by default. Team workspaces (and their memberships) may
  // still exist as infrastructure for a future opt-in "switch workspace"
  // feature, but they are intentionally NOT resolved here: we always pick the
  // user's personal workspace, creating it on first login. (Resolving by
  // earliest membership of ANY type is what made every teammate share the seeded
  // "Optinet Team" workspace.)
  const existing = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { type: "personal" } },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  if (existing) return { workspaceId: existing.workspaceId };

  // First login: create User + personal Workspace + WorkspaceMember in one
  // transaction. On a concurrent-first-request race the catch block re-reads.
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
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });
    if (member) return { workspaceId: member.workspaceId };
    throw new Error(`Failed to create workspace for user ${userId}`);
  }
}
