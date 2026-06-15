import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// GET /api/contacts/:id  (with notes)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { notes: { orderBy: { createdAt: "desc" } } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(contact);
}

const EDITABLE = [
  "name",
  "email",
  "phone",
  "company",
  "title",
  "location",
  "tags",
  "howWeMet",
] as const;

// PATCH /api/contacts/:id
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const data: Record<string, string | null> = {};
  for (const key of EDITABLE) {
    if (key in body) {
      const v = typeof body[key] === "string" ? body[key].trim() : body[key];
      data[key] = v || null;
    }
  }
  if ("name" in data && !data.name) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }

  try {
    const contact = await prisma.contact.update({ where: { id }, data });
    return NextResponse.json(contact);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

// DELETE /api/contacts/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await prisma.contact.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
