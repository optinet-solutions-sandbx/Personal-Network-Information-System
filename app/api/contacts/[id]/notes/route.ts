import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";
import type { NoteSource } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// GET /api/contacts/:id/notes
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const notes = await prisma.note.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(notes);
}

// POST /api/contacts/:id/notes
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const contact = await prisma.contact.findUnique({ where: { id } });
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
  const note = await prisma.note.create({
    data: { contactId: id, content: body.content.trim(), source },
  });
  await prisma.contact.update({ where: { id }, data: { updatedAt: new Date() } });
  await recalculateHealth(id);

  return NextResponse.json(note, { status: 201 });
}
