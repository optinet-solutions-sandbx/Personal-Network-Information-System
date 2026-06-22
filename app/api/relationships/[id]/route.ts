import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, ownerWhere } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/relationships/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const edge = await prisma.relationship.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    select: { id: true },
  });
  if (!edge) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.relationship.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
