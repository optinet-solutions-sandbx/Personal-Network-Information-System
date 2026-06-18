import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/notes/:id
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  try {
    const note = await prisma.note.update({
      where: { id },
      data: { content: body.content.trim() },
    });
    await recalculateHealth(note.contactId);
    return NextResponse.json(note);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

// DELETE /api/notes/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const note = await prisma.note.findUnique({
      where: { id },
      select: { contactId: true },
    });
    await prisma.note.delete({ where: { id } });
    if (note) await recalculateHealth(note.contactId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
