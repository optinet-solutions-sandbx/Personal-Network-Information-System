import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { validateAttachmentMeta } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

// GET /api/contacts/:id/attachments[?noteId=<id>|null]
// Lists a contact's files. `?noteId=null` returns only contact-level files;
// `?noteId=<id>` returns the files attached to that note; omitted returns all.
export async function GET(req: NextRequest, { params }: Params) {
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

  const noteParam = new URL(req.url).searchParams.get("noteId");
  const where: { contactId: string; noteId?: string | null } = { contactId: id };
  if (noteParam === "null") where.noteId = null;
  else if (noteParam) where.noteId = noteParam;

  const attachments = await prisma.attachment.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(attachments);
}

// POST /api/contacts/:id/attachments
// Records metadata for a file the client already uploaded to Storage. The bytes
// went browser -> Storage directly (see lib/attachments.ts); here we authorize
// and persist the metadata, scoped to the authenticated owner.
export async function POST(req: NextRequest, { params }: Params) {
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

  const body = await req.json().catch(() => null);
  const v = validateAttachmentMeta(body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  // The object must live in the signed-in user's own folder for this contact —
  // guards against a client recording a path it doesn't own (Storage RLS also
  // enforces this on upload). In open mode there's no userId, so Storage isn't
  // usable anyway and this check is skipped.
  if (owner.userId) {
    const prefix = `${owner.userId}/${id}/`;
    if (!v.data.storagePath.startsWith(prefix)) {
      return NextResponse.json(
        { error: "storagePath is outside your folder" },
        { status: 400 }
      );
    }
  }

  // A note-scoped attachment must reference a note that belongs to THIS contact.
  if (v.data.noteId) {
    const note = await prisma.note.findFirst({
      where: { id: v.data.noteId, contactId: id },
      select: { id: true },
    });
    if (!note) {
      return NextResponse.json({ error: "note not found" }, { status: 404 });
    }
  }

  try {
    const attachment = await prisma.attachment.create({
      data: {
        contactId: id,
        noteId: v.data.noteId,
        userId: owner.userId,
        workspaceId: owner.workspaceId,
        filename: v.data.filename,
        mimeType: v.data.mimeType,
        size: v.data.size,
        storagePath: v.data.storagePath,
      },
    });
    return NextResponse.json(attachment, { status: 201 });
  } catch (err) {
    console.error("POST /api/contacts/[id]/attachments failed:", err);
    return NextResponse.json(
      { error: "Could not save the attachment. Please try again." },
      { status: 500 }
    );
  }
}
