import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateGiftSuggestions } from "@/lib/gifts";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { notes: { orderBy: { createdAt: "desc" }, take: 5 } },
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
    const { suggestions, model } = await generateGiftSuggestions({
      name: contact.name,
      title: contact.title,
      company: contact.company,
      howWeMet: contact.howWeMet,
      customFields,
      recentNotes: contact.notes.map((n) => n.content),
    });
    return NextResponse.json({ suggestions, model });
  } catch (err) {
    console.error("Gift suggestions route failed:", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
