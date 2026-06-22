import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";
import { resolveOwner } from "@/lib/auth";
import { validateNoteContent, validateNoteImages } from "@/lib/validation";

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

  // `images` is only touched when the caller sends the key, so a plain text
  // edit leaves existing photos intact.
  const imagesProvided = body != null && "images" in body;
  const imgs = validateNoteImages(imagesProvided ? body.images : null);
  if (!imgs.ok) {
    return NextResponse.json({ error: imgs.error }, { status: 400 });
  }

  // Content is required unless the resulting note still has at least one photo.
  const rawContent = typeof body?.content === "string" ? body.content.trim() : "";
  let content: string;
  if (rawContent === "" && imagesProvided && imgs.data.length > 0) {
    content = "";
  } else {
    const valid = validateNoteContent(body?.content);
    if (!valid.ok) {
      return NextResponse.json({ error: valid.error }, { status: 400 });
    }
    content = valid.data;
  }

  const data: { content: string; images?: string[] } = { content };
  if (imagesProvided) data.images = imgs.data;

  const result = await prisma.note.updateMany({
    where: ownedNoteWhere(id, owner.userId),
    data,
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
