import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";

type Params = { params: Promise<{ id: string }> };

// Scope an attachment to the owner's workspace via its parent contact (mirrors
// the note ownership check in app/api/notes/[id]/route.ts).
function ownedAttachmentWhere(id: string, workspaceId: string | null) {
  return workspaceId ? { id, contact: { workspaceId } } : { id };
}

// GET /api/attachments/:id
// Redirects to a short-lived signed URL for the file (the bucket is private, so
// objects are never directly reachable). The signed URL carries a Content-
// Disposition that downloads the file under its original name.
export async function GET(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const att = await prisma.attachment.findFirst({
    where: ownedAttachmentWhere(id, owner.workspaceId),
    select: { storagePath: true, filename: true },
  });
  if (!att) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(att.storagePath, 60, { download: att.filename });
  if (error || !data?.signedUrl) {
    console.error("attachment signed-url failed:", error?.message);
    return NextResponse.json(
      { error: "Could not generate a download link." },
      { status: 502 }
    );
  }
  return NextResponse.redirect(data.signedUrl);
}

// DELETE /api/attachments/:id
// Removes the object from Storage, then the metadata row.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const att = await prisma.attachment.findFirst({
    where: ownedAttachmentWhere(id, owner.workspaceId),
    select: { id: true, storagePath: true },
  });
  if (!att) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabase = await createClient();
  // Best-effort object removal — we still delete the metadata row so the UI
  // stays consistent even if the object is already gone.
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .remove([att.storagePath]);
  if (error) {
    console.error("attachment object removal failed (continuing):", error.message);
  }

  await prisma.attachment.delete({ where: { id: att.id } });
  return NextResponse.json({ ok: true });
}
