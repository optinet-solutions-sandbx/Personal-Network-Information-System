import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateBriefing } from "@/lib/briefing";
import { resolveOwner, ownerWhere } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.workspaceId) },
    include: { notes: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let customFields: Record<string, string> | null = null;
  if (contact.customFields) {
    try {
      customFields = JSON.parse(contact.customFields) as Record<string, string>;
    } catch {
      customFields = null;
    }
  }

  try {
    const { briefing } = await generateBriefing({
      name: contact.name,
      title: contact.title,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
      location: contact.location,
      tags: contact.tags,
      howWeMet: contact.howWeMet,
      birthday: contact.birthday,
      customFields,
      profile: contact.profile,
      notes: contact.notes.map((n) => ({
        content: n.content,
        createdAt: n.createdAt,
      })),
    });
    return NextResponse.json({ briefing });
  } catch (err) {
    console.error("Briefing route failed:", err);
    return NextResponse.json({ error: "generation failed" }, { status: 502 });
  }
}
