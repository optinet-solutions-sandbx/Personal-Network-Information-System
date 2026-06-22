import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveOwner, ownerWhere } from "@/lib/auth"
import { computeInsights } from "@/lib/insights"
import type { Contact } from "@/lib/types"

export async function GET() {
  const owner = await resolveOwner()
  if (!owner.ok) return owner.response

  const rows = await prisma.contact.findMany({
    where: ownerWhere(owner.userId),
    select: {
      id: true,
      name: true,
      company: true,
      location: true,
      tags: true,
      birthday: true,
      customFields: true,
      profileUpdatedAt: true,
      healthTier: true,
      healthScore: true,
      healthInputs: true,
      followUpCadence: true,
      followUpCadenceDays: true,
    },
  })

  const contacts: Contact[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: null,
    phone: null,
    company: r.company,
    title: null,
    location: r.location,
    tags: r.tags,
    birthday: r.birthday,
    howWeMet: null,
    customFields: safeParseJson(r.customFields),
    profile: null,
    profileModel: null,
    profileUpdatedAt: r.profileUpdatedAt?.toISOString() ?? null,
    healthScore: r.healthScore,
    healthTier: r.healthTier,
    healthInputs: safeParseJson(r.healthInputs),
    followUpCadence: r.followUpCadence,
    followUpCadenceDays: r.followUpCadenceDays,
    createdAt: "",
    updatedAt: "",
  }))

  return NextResponse.json(computeInsights(contacts))
}

function safeParseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
