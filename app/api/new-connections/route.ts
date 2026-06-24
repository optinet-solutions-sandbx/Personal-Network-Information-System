import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"
import { NEW_CONNECTION_WINDOW_DAYS } from "@/lib/new-connections"

// Shape returned to the dashboard widget / banners.
export type NewConnectionContact = {
  id: string
  name: string
  title: string | null
  company: string | null
  email: string | null
  createdAt: string
}

export type NewConnectionLink = {
  id: string
  type: string
  createdAt: string
  contact: NewConnectionContact // the linked ("to") contact you can greet
  via: { id: string; name: string } | null // the "from" side, for context
}

// GET /api/new-connections
// Recently-created connections you haven't greeted yet, from two sources:
//  - contacts added within the window with no sent message
//  - relationship links created within the window (greeting targets the "to"
//    contact), excluding ones whose target was already greeted or already
//    appears in the contacts list (so each person shows once).
export async function GET() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const since = new Date(Date.now() - NEW_CONNECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const scope = ownerWhere(owner.workspaceId)

  const [contacts, rels] = await Promise.all([
    prisma.contact.findMany({
      where: {
        ...scope,
        createdAt: { gte: since },
        sentMessages: { none: {} },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        name: true,
        title: true,
        company: true,
        email: true,
        createdAt: true,
      },
    }),
    prisma.relationship.findMany({
      where: { ...scope, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        type: true,
        createdAt: true,
        from: { select: { id: true, name: true } },
        to: {
          select: {
            id: true,
            name: true,
            title: true,
            company: true,
            email: true,
            createdAt: true,
            sentMessages: { select: { id: true }, take: 1 },
          },
        },
      },
    }),
  ])

  // De-dupe: a freshly-added contact may also be the target of a new link.
  // Show it once, in the contacts list.
  const contactIds = new Set(contacts.map((c) => c.id))

  const links: NewConnectionLink[] = rels
    .filter((r) => r.to.sentMessages.length === 0 && !contactIds.has(r.to.id))
    .map((r) => ({
      id: r.id,
      type: r.type,
      createdAt: r.createdAt.toISOString(),
      contact: {
        id: r.to.id,
        name: r.to.name,
        title: r.to.title,
        company: r.to.company,
        email: r.to.email,
        createdAt: r.to.createdAt.toISOString(),
      },
      via: r.from ? { id: r.from.id, name: r.from.name } : null,
    }))

  const contactsOut: NewConnectionContact[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    company: c.company,
    email: c.email,
    createdAt: c.createdAt.toISOString(),
  }))

  return NextResponse.json({ contacts: contactsOut, links })
}
