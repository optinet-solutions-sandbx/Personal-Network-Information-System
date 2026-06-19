import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { NoteSource } from "@/lib/types";
import { getWorkspaceContext } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Verify contact belongs to this workspace
  const contact = await prisma.contact.findUnique({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });

  const notes = await prisma.note.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  // Verify contact belongs to this workspace before creating a note
  const contact = await prisma.contact.findUnique({
    where: { id, workspaceId: ctx.workspaceId },
  });
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  const source: NoteSource =
    body.source === "voice" ? "voice" : body.source === "story" ? "story" : "manual";
  const note = await prisma.note.create({
    data: { contactId: id, content: body.content.trim(), source },
  });
  await prisma.contact.update({ where: { id }, data: { updatedAt: new Date() } });

  return NextResponse.json(note, { status: 201 });
}
