import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { validateNoteContent, validateNoteImages } from "@/lib/validation";
import type { NoteSource } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// GET /api/contacts/:id/notes
export async function GET(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    select: { id: true },
  });
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  const notes = await prisma.note.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(notes);
}

// POST /api/contacts/:id/notes
export async function POST(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const imgs = validateNoteImages(body?.images);
  if (!imgs.ok) {
    return NextResponse.json({ error: imgs.error }, { status: 400 });
  }

  // A note may be photo-only: content is required unless at least one photo is
  // attached, in which case empty content is allowed.
  const rawContent = typeof body?.content === "string" ? body.content.trim() : "";
  let content: string;
  if (rawContent === "" && imgs.data.length > 0) {
    content = "";
  } else {
    const valid = validateNoteContent(body?.content);
    if (!valid.ok) {
      return NextResponse.json({ error: valid.error }, { status: 400 });
    }
    content = valid.data;
  }

  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    select: { id: true },
  });
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  const source: NoteSource =
    body.source === "voice"
      ? "voice"
      : body.source === "story"
      ? "story"
      : body.source === "gift"
      ? "gift"
      : "manual";

  try {
    const note = await prisma.note.create({
      data: { contactId: id, content, source, images: imgs.data },
    });
    // touch the contact so it sorts to the top of the recently-updated list
    await prisma.contact.update({ where: { id }, data: { updatedAt: new Date() } });
    // adding a note is a relationship signal — refresh the health score
    await recalculateHealth(id);
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    console.error("POST /api/contacts/[id]/notes failed:", err);
    return NextResponse.json(
      { error: "Could not save note. Please try again." },
      { status: 500 }
    );
  }
}
