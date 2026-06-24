import { NextRequest, NextResponse } from "next/server";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/meetings/:id  { followUpDone: boolean }
// Mark a meeting's follow-up as done (or reopen it). Scoped to the owner's
// workspace via updateMany so one workspace can't touch another's events.
export async function PATCH(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const followUpDone = typeof body?.followUpDone === "boolean" ? body.followUpDone : true;

  const result = await prisma.calendarEvent.updateMany({
    where: { id, ...ownerWhere(owner.workspaceId) },
    data: { followUpDone },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "meeting not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, followUpDone });
}
