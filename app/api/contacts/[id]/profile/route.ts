import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateProfile } from "@/lib/profile";
import { resolveOwner, ownerWhere } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

// POST /api/contacts/:id/profile — generate (or regenerate) the AI-assisted profile
export async function POST(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    include: { notes: { orderBy: { createdAt: "asc" } } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let profile: string;
  let model: string;
  try {
    ({ profile, model } = await generateProfile({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      title: contact.title,
      location: contact.location,
      tags: contact.tags,
      howWeMet: contact.howWeMet,
      notes: contact.notes.map((n) => ({
        content: n.content,
        createdAt: n.createdAt,
      })),
    }));
  } catch (err) {
    console.error("Profile generation failed:", err);
    return NextResponse.json(
      { error: "Profile generation failed. The AI service may be unavailable — please try again." },
      { status: 502 }
    );
  }

  const updated = await prisma.contact.update({
    where: { id },
    data: { profile, profileModel: model, profileUpdatedAt: new Date() },
  });

  return NextResponse.json(updated);
}
