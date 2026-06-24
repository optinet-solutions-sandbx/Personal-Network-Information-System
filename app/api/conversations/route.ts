import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner } from "@/lib/auth"

export type Conversation = {
  contactId: string
  contact: { id: string; name: string; email: string | null }
  lastBody: string
  lastSentAt: string
  method: string
}

// GET /api/conversations
// One row per contact you've messaged — the latest message, newest first.
// Powers the Messenger-style "Chats" list so you can reopen past conversations.
// Scoped by userId to match the rest of the messaging surface.
export async function GET() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  // Pull recent messages and collapse to the latest per contact. 300 is plenty
  // for a personal CRM; conversations beyond that simply don't surface here.
  const recent = await prisma.sentMessage.findMany({
    where: { userId: owner.userId },
    orderBy: { sentAt: "desc" },
    take: 300,
    include: { contact: { select: { id: true, name: true, email: true } } },
  })

  const seen = new Set<string>()
  const conversations: Conversation[] = []
  for (const m of recent) {
    if (seen.has(m.contactId)) continue
    seen.add(m.contactId)
    conversations.push({
      contactId: m.contactId,
      contact: m.contact,
      lastBody: m.body,
      lastSentAt: m.sentAt.toISOString(),
      method: m.method,
    })
  }

  return NextResponse.json(conversations)
}
