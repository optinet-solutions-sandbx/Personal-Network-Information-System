import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner } from "@/lib/auth";
import { assertWorkspaceRole, inviteIsValid } from "@/lib/workspace";

type Params = { params: Promise<{ id: string; inviteId: string }> };

// DELETE /api/workspaces/[id]/invites/[inviteId]
// Two-stage: an ACTIVE link is soft-revoked (sets revokedAt) so the link in the
// wild stops working but a record remains; an already-revoked/expired link is
// hard-deleted so admins can clear dead entries from the list. Owner/admin only.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { id, inviteId } = await params;
  const gate = await assertWorkspaceRole(owner.userId, id, "admin");
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const invite = await prisma.workspaceInvite.findFirst({
    where: { id: inviteId, workspaceId: id },
    select: { id: true, revokedAt: true, expiresAt: true },
  });
  if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (inviteIsValid(invite)) {
    await prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
    return NextResponse.json({ ok: true, revoked: true });
  }

  await prisma.workspaceInvite.delete({ where: { id: inviteId } });
  return NextResponse.json({ ok: true, cleared: true });
}
