import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateProfile } from "@/lib/profile";
import { getWorkspaceContext } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const contact = await prisma.contact.findUnique({
    where: { id, workspaceId: ctx.workspaceId },
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
