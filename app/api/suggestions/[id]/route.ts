import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const body = await req.json().catch(() => ({}))
  const { status } = body as { status?: string }

  if (status !== "accepted" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be 'accepted' or 'dismissed'" },
      { status: 400 }
    )
  }

  const result = await prisma.suggestion.updateMany({
    where: { id, ...ownerWhere(owner.workspaceId) },
    data: { status, respondedAt: new Date() },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
