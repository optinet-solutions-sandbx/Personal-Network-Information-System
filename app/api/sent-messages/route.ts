import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"
import { validateSentMessageBody } from "@/lib/validation"

// POST /api/sent-messages
export async function POST(req: NextRequest) {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const raw = await req.json().catch(() => null)
  const valid = validateSentMessageBody(raw)
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 })
  }

  const { contactId, body, method } = valid.data

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ...ownerWhere(owner.userId) },
    select: { id: true },
  })
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 })
  }

  try {
    const sent = await prisma.sentMessage.create({
      data: { userId: owner.userId, contactId, body, method },
    })
    return NextResponse.json(sent, { status: 201 })
  } catch (err) {
    console.error("POST /api/sent-messages failed:", err)
    return NextResponse.json({ error: "Could not save sent message." }, { status: 500 })
  }
}

// GET /api/sent-messages
export async function GET() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const messages = await prisma.sentMessage.findMany({
    where: ownerWhere(owner.userId),
    orderBy: { sentAt: "desc" },
    take: 20,
    include: { contact: { select: { id: true, name: true } } },
  })
  return NextResponse.json(messages)
}
