import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateProfile } from "@/lib/profile";

type Params = { params: Promise<{ id: string }> };

// POST /api/contacts/:id/profile — generate (or regenerate) the AI-assisted profile
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { notes: { orderBy: { createdAt: "asc" } } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { profile, model } = await generateProfile({
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
  });

  const updated = await prisma.contact.update({
    where: { id },
    data: { profile, profileModel: model, profileUpdatedAt: new Date() },
  });

  return NextResponse.json(updated);
}
