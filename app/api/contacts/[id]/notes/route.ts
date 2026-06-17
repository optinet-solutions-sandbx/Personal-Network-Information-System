import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { validateNoteContent } from "@/lib/validation";
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

  const valid = validateNoteContent(body?.content);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }

  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    select: { id: true },
  });
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  const source: NoteSource =
    body.source === "voice" ? "voice" : body.source === "story" ? "story" : "manual";

  try {
    const note = await prisma.note.create({
      data: { contactId: id, content: valid.data, source },
    });
    // touch the contact so it sorts to the top of the recently-updated list
    await prisma.contact.update({ where: { id }, data: { updatedAt: new Date() } });
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    console.error("POST /api/contacts/[id]/notes failed:", err);
    return NextResponse.json(
      { error: "Could not save note. Please try again." },
      { status: 500 }
    );
  }
}
