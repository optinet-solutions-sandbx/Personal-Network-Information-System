import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner } from "@/lib/auth";
import { assertWorkspaceRole, generateInviteToken } from "@/lib/workspace";
import { validateInviteCreate } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

const INVITE_SELECT = {
  id: true,
  token: true,
  role: true,
  expiresAt: true,
  revokedAt: true,
  usedCount: true,
  createdAt: true,
} as const;

// GET /api/workspaces/[id]/invites — list invite links (newest first). The
// caller builds /join/<token> links from the tokens. Owner/admin only.
export async function GET(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { id } = await params;
  const gate = await assertWorkspaceRole(owner.userId, id, "admin");
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const invites = await prisma.workspaceInvite.findMany({
    where: { workspaceId: id },
    select: INVITE_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ invites });
}

// POST /api/workspaces/[id]/invites  { role?, expiresInMinutes? }
// Create a multi-use shareable invite link. Owner/admin only.
export async function POST(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { id } = await params;
  const gate = await assertWorkspaceRole(owner.userId, id, "admin");
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const parsed = validateInviteCreate(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { role, expiresInMinutes } = parsed.data;
  const expiresAt =
    expiresInMinutes == null ? null : new Date(Date.now() + expiresInMinutes * 60_000);

  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId: id,
      token: generateInviteToken(),
      role,
      expiresAt,
      createdByUserId: owner.userId,
    },
    select: INVITE_SELECT,
  });
  return NextResponse.json(invite, { status: 201 });
}
