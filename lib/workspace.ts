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
