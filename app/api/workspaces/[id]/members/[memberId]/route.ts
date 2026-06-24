import { NextRequest, NextResponse } from "next/server";
import type { MemberRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOwner, clearWorkspaceSelection } from "@/lib/auth";
import { membershipRole, roleAtLeast } from "@/lib/workspace";

type Params = { params: Promise<{ id: string; memberId: string }> };

// Count owners so we never demote/remove the last one (which would orphan the
// workspace).
async function ownerCount(workspaceId: string): Promise<number> {
  return prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } });
}

// PATCH /api/workspaces/[id]/members/[memberId]  { role }
// Change a member's role. Owner can set any role (including transferring
// ownership); admin can only manage member⇄admin and may not touch owners.
export async function PATCH(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { id, memberId } = await params;
  const actorRole = await membershipRole(owner.userId, id);
  if (!actorRole || !roleAtLeast(actorRole, "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const newRole = (body as { role?: unknown })?.role;
  if (newRole !== "member" && newRole !== "admin" && newRole !== "owner") {
    return NextResponse.json({ error: 'role must be "member", "admin", or "owner"' }, { status: 400 });
  }

  const target = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId: id },
    select: { id: true, role: true, userId: true },
  });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Admins can't manage owners, and only owners can grant ownership.
  if (actorRole !== "owner" && (target.role === "owner" || newRole === "owner")) {
    return NextResponse.json({ error: "only an owner can manage ownership" }, { status: 403 });
  }

  // Never leave the workspace ownerless.
  if (target.role === "owner" && newRole !== "owner" && (await ownerCount(id)) <= 1) {
    return NextResponse.json(
      { error: "can't demote the last owner — promote someone else first" },
      { status: 400 }
    );
  }

  const updated = await prisma.workspaceMember.update({
    where: { id: memberId },
    data: { role: newRole as MemberRole },
    select: { id: true, role: true },
  });
  return NextResponse.json(updated);
}

// DELETE /api/workspaces/[id]/members/[memberId]
// Remove a member, or leave the workspace (removing yourself). Owners/admins can
// remove others (admins not owners); anyone can remove themselves. The last
// owner can't be removed.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { id, memberId } = await params;
  const actorRole = await membershipRole(owner.userId, id);
  if (!actorRole) return NextResponse.json({ error: "not found" }, { status: 404 });

  const target = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId: id },
    select: { id: true, role: true, userId: true },
  });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isSelf = target.userId === owner.userId;

  // Authorization: removing someone else requires admin+; admins can't remove
  // owners. Removing yourself (leave) is always allowed (subject to last-owner).
  if (!isSelf) {
    if (!roleAtLeast(actorRole, "admin")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (target.role === "owner" && actorRole !== "owner") {
      return NextResponse.json({ error: "only an owner can remove an owner" }, { status: 403 });
    }
  }

  if (target.role === "owner" && (await ownerCount(id)) <= 1) {
    return NextResponse.json(
      { error: "the last owner can't leave — transfer ownership or delete the workspace" },
      { status: 400 }
    );
  }

  await prisma.workspaceMember.delete({ where: { id: memberId } });

  // If you just left your active workspace, drop the selection cookie.
  if (isSelf && owner.workspaceId === id) await clearWorkspaceSelection();

  return NextResponse.json({ ok: true });
}
