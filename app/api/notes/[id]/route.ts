import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";
import { resolveOwner } from "@/lib/auth";
import { validateNoteContent } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

// Scope a note to the owner via its parent contact.
function ownedNoteWhere(id: string, userId: string | null) {
  return userId ? { id, contact: { userId } } : { id };
}

// PATCH /api/notes/:id
export async function PATCH(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const valid = validateNoteContent(body?.content);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }

  const result = await prisma.note.updateMany({
    where: ownedNoteWhere(id, owner.userId),
    data: { content: valid.data },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const note = await prisma.note.findUnique({ where: { id } });
  // editing a note is a relationship signal — refresh the health score
  if (note) await recalculateHealth(note.contactId).catch(() => {});
  return NextResponse.json(note);
}

// DELETE /api/notes/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  // capture the parent contact before deletion so we can refresh its health score
  const note = await prisma.note.findFirst({
    where: ownedNoteWhere(id, owner.userId),
    select: { contactId: true },
  });
  const result = await prisma.note.deleteMany({
    where: ownedNoteWhere(id, owner.userId),
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (note) await recalculateHealth(note.contactId).catch(() => {});
  return NextResponse.json({ ok: true });
}
