import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, setWorkspaceSelection } from "@/lib/auth";
import { inviteIsValid } from "@/lib/workspace";

type Params = { params: Promise<{ token: string }> };

// POST /api/invites/[token]/accept
// Join the workspace behind a shareable invite link. Must be signed in. The
// link is multi-use: anyone who opens it joins (no-op if already a member) with
// the invite's role, until it expires or is revoked. On success the caller is
// switched into the joined workspace.
export async function POST(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  // 401 signals the client to send the user through /login and back.
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { token } = await params;
  const invite = await prisma.workspaceInvite.findUnique({
    where: { token },
    select: {
      id: true,
      workspaceId: true,
      role: true,
      revokedAt: true,
      expiresAt: true,
      workspace: { select: { name: true } },
    },
  });
  if (!invite) return NextResponse.json({ error: "invite not found" }, { status: 404 });
  if (!inviteIsValid(invite)) {
    return NextResponse.json({ error: "this invite is no longer valid" }, { status: 410 });
  }

  // Join only if not already a member, and count the use only on a real join.
  const existing = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: owner.userId, workspaceId: invite.workspaceId } },
    select: { id: true },
  });
  if (!existing) {
    await prisma.$transaction([
      prisma.workspaceMember.create({
        data: { userId: owner.userId, workspaceId: invite.workspaceId, role: invite.role },
      }),
      prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { usedCount: { increment: 1 } },
      }),
    ]);
  }

  // Switch the user into the workspace they just joined.
  await setWorkspaceSelection(invite.workspaceId);
  return NextResponse.json({
    ok: true,
    workspaceId: invite.workspaceId,
    workspaceName: invite.workspace.name,
    alreadyMember: Boolean(existing),
  });
}
