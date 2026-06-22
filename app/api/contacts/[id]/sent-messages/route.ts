import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"

type Params = { params: Promise<{ id: string }> }

// GET /api/contacts/:id/sent-messages
export async function GET(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const { id } = await params

  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    select: { id: true },
  })
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 })
  }

  const messages = await prisma.sentMessage.findMany({
    where: { contactId: id },
    orderBy: { sentAt: "desc" },
  })
  return NextResponse.json(messages)
}
