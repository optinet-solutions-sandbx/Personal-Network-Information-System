import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Case-insensitive substring search (Postgres ILIKE under the hood).
const insensitive = (q: string) => ({ contains: q, mode: Prisma.QueryMode.insensitive });

// GET /api/contacts?q=search
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();

  const where = q
    ? {
        OR: [
          { name: insensitive(q) },
          { email: insensitive(q) },
          { company: insensitive(q) },
          { title: insensitive(q) },
          { tags: insensitive(q) },
          { location: insensitive(q) },
        ],
      }
    : undefined;

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { notes: true } } },
  });

  return NextResponse.json(contacts);
}

// POST /api/contacts
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const contact = await prisma.contact.create({
    data: {
      name: body.name.trim(),
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      company: body.company?.trim() || null,
      title: body.title?.trim() || null,
      location: body.location?.trim() || null,
      tags: body.tags?.trim() || null,
      howWeMet: body.howWeMet?.trim() || null,
    },
  });

  return NextResponse.json(contact, { status: 201 });
}
