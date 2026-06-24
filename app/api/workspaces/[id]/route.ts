import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, clearWorkspaceSelection } from "@/lib/auth";
import { assertWorkspaceRole, membershipRole } from "@/lib/workspace";
import { validateWorkspaceUpdate } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

// GET /api/workspaces/[id] — workspace profile + members. Any member may read.
export async function GET(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { id } = await params;
  const role = await membershipRole(owner.userId, id);
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ws = await prisma.workspace.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      avatar: true,
      type: true,
      members: {
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true, avatar: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!ws) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ ...ws, role });
}

// PATCH /api/workspaces/[id] — update name/description/avatar. Owner or admin.
export async function PATCH(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { id } = await params;
  const gate = await assertWorkspaceRole(owner.userId, id, "admin");
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const parsed = validateWorkspaceUpdate(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updated = await prisma.workspace.update({
    where: { id },
    data: parsed.data,
    select: { id: true, name: true, description: true, avatar: true, type: true },
  });
  return NextResponse.json(updated);
}

// DELETE /api/workspaces/[id] — delete a TEAM workspace. Owner only. A personal
// workspace can never be deleted (it's the guaranteed fallback).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const { id } = await params;
  const gate = await assertWorkspaceRole(owner.userId, id, "owner");
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const ws = await prisma.workspace.findUnique({ where: { id }, select: { type: true } });
  if (!ws) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ws.type === "personal") {
    return NextResponse.json(
      { error: "a personal workspace cannot be deleted" },
      { status: 400 }
    );
  }

  // Contacts (and their notes/attachments/suggestions/relationships), members,
  // and invites cascade with the workspace. Connections carry a bare workspaceId
  // (no FK), so remove them explicitly in the same transaction.
  await prisma.$transaction([
    prisma.connection.deleteMany({ where: { workspaceId: id } }),
    prisma.workspace.delete({ where: { id } }),
  ]);

  // If the deleted workspace was the active selection, drop the cookie so the
  // next request falls back to the user's personal workspace.
  if (owner.workspaceId === id) await clearWorkspaceSelection();

  return NextResponse.json({ ok: true });
}
