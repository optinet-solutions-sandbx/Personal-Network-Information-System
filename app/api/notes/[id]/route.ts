import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  // Verify the note's contact belongs to this workspace
  const note = await prisma.note.findFirst({
    where: { id, contact: { workspaceId: ctx.workspaceId } },
  });
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updated = await prisma.note.update({
    where: { id },
    data: { content: body.content.trim() },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Verify the note's contact belongs to this workspace
  const note = await prisma.note.findFirst({
    where: { id, contact: { workspaceId: ctx.workspaceId } },
  });
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.note.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
