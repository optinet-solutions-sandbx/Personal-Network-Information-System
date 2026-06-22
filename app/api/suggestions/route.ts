import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"
import { generateIntroductionSuggestions } from "@/lib/introductions"
import type { Contact } from "@/lib/types"

export async function GET() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const rows = await prisma.suggestion.findMany({
    where: { ...ownerWhere(owner.workspaceId), status: "pending" },
    include: {
      contactA: { select: { id: true, name: true, title: true, company: true } },
      contactB: { select: { id: true, name: true, title: true, company: true } },
    },
    orderBy: { score: "desc" },
    take: 5,
  })

  return NextResponse.json(rows)
}

export async function POST() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const rows = await prisma.contact.findMany({
    where: ownerWhere(owner.workspaceId),
    select: { id: true, name: true, title: true, company: true, tags: true, profile: true },
  })

  // Map to Contact shape — only the fields introductions.ts needs
  const contacts: Contact[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: null,
    phone: null,
    company: r.company,
    title: r.title,
    location: null,
    tags: r.tags,
    birthday: null,
    howWeMet: null,
    customFields: null,
    profile: r.profile,
    profileModel: null,
    profileUpdatedAt: null,
    healthScore: null,
    healthTier: null,
    healthInputs: null,
    followUpCadence: null,
    followUpCadenceDays: null,
    createdAt: "",
    updatedAt: "",
  }))

  // Exclude pairs already accepted or dismissed from this generation run
  const responded = await prisma.suggestion.findMany({
    where: {
      ...ownerWhere(owner.workspaceId),
      status: { in: ["dismissed", "accepted"] },
    },
    select: { contactAId: true, contactBId: true },
  })
  const respondedPairs = new Set(
    responded.map((d) => `${d.contactAId}:${d.contactBId}`)
  )

  const candidates = await generateIntroductionSuggestions(contacts, respondedPairs)

  let generated = 0
  for (const c of candidates) {
    await prisma.suggestion.upsert({
      where: {
        contactAId_contactBId: { contactAId: c.contactAId, contactBId: c.contactBId },
      },
      update: {
        rationale: c.rationale,
        score: c.score,
        generatedAt: new Date(),
      },
      create: {
        userId: owner.userId,
        workspaceId: owner.workspaceId,
        contactAId: c.contactAId,
        contactBId: c.contactBId,
        rationale: c.rationale,
        score: c.score,
        status: "pending",
      },
    })
    generated++
  }

  return NextResponse.json({ generated })
}
