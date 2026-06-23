import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import {
  validateNoteContent,
  validateNoteImages,
  validateNoteAudioUrl,
} from "@/lib/validation";
import { summarizeTranscript } from "@/lib/note-summary";
import type { NoteSource } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// GET /api/contacts/:id/notes
export async function GET(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.workspaceId) },
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

  const audio = validateNoteAudioUrl(body?.audioUrl);
  if (!audio.ok) {
    return NextResponse.json({ error: audio.error }, { status: 400 });
  }

  // A note may be photo- or audio-only: content is required unless at least one
  // photo or a voice recording is attached, in which case empty content is OK.
  const rawContent = typeof body?.content === "string" ? body.content.trim() : "";
  let content: string;
  if (rawContent === "" && (imgs.data.length > 0 || audio.data)) {
    content = "";
  } else {
    const valid = validateNoteContent(body?.content);
    if (!valid.ok) {
      return NextResponse.json({ error: valid.error }, { status: 400 });
    }
    content = valid.data;
  }

  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.workspaceId) },
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

  // Voice notes get an AI summary of the transcript (best-effort; never blocks
  // the save). Skipped for short notes and other sources.
  let summary: string | null = null;
  if (source === "voice" && content) {
    try {
      summary = (await summarizeTranscript(content)).summary;
    } catch (err) {
      console.error("note summary failed (non-fatal):", err);
    }
  }

  try {
    const note = await prisma.note.create({
      data: {
        contactId: id,
        content,
        source,
        images: imgs.data,
        audioUrl: audio.data,
        summary,
      },
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
