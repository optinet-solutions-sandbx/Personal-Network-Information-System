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

  const suggestion = await prisma.suggestion.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
  })
  if (!suggestion) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const updated = await prisma.suggestion.update({
    where: { id },
    data: { status, respondedAt: new Date() },
  })

  return NextResponse.json(updated)
}
