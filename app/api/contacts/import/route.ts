import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { validateContact } from "@/lib/validation";

// Cap a single import so a huge file can't blow up the request / DB.
const MAX_IMPORT = 2000;

// Dedupe key: case-insensitive name + email (email may be empty).
function keyOf(name: string, email: string | null): string {
  return `${name.trim().toLowerCase()}|${(email ?? "").trim().toLowerCase()}`;
}

// POST /api/contacts/import  { contacts: ContactInput[] }
// Validates + dedupes (against existing and within the batch) and bulk-creates.
export async function POST(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const body = await req.json().catch(() => null);
  const list = Array.isArray(body?.contacts) ? body.contacts : null;
  if (!list) {
    return NextResponse.json({ error: "expected { contacts: [...] }" }, { status: 400 });
  }
  if (list.length > MAX_IMPORT) {
    return NextResponse.json(
      { error: `too many contacts in one import (max ${MAX_IMPORT})` },
      { status: 400 }
    );
  }

  // Existing contacts for dedupe.
  const existing = await prisma.contact.findMany({
    where: ownerWhere(owner.userId),
    select: { name: true, email: true },
  });
  const seen = new Set(existing.map((c) => keyOf(c.name, c.email)));

  const toCreate: Array<Record<string, unknown>> = [];
  let invalid = 0;
  let duplicates = 0;

  for (const raw of list) {
    const valid = validateContact(raw);
    if (!valid.ok || !valid.data.name) {
      invalid++;
      continue;
    }
    const d = valid.data;
    const key = keyOf(d.name!, d.email ?? null);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    toCreate.push({
      userId: owner.userId,
      name: d.name,
      email: d.email ?? null,
      phone: d.phone ?? null,
      company: d.company ?? null,
      title: d.title ?? null,
      location: d.location ?? null,
      tags: d.tags ?? null,
      birthday: d.birthday ?? null,
      howWeMet: d.howWeMet ?? null,
      customFields: d.customFields ? JSON.stringify(d.customFields) : null,
    });
  }

  let created = 0;
  if (toCreate.length) {
    try {
      const res = await prisma.contact.createMany({ data: toCreate as never });
      created = res.count;
    } catch (err) {
      console.error("POST /api/contacts/import failed:", err);
      return NextResponse.json(
        { error: "Could not import contacts. Please try again." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    received: list.length,
    created,
    duplicates,
    invalid,
  });
}
