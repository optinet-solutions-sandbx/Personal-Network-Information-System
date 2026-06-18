import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { validateContact } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

function parseCustomFields(c: Record<string, unknown>) {
  const raw = c.customFields;
  return {
    ...c,
    customFields:
      typeof raw === "string" && raw
        ? (JSON.parse(raw) as Record<string, string>)
        : null,
  };
}

// GET /api/contacts/:id  (with notes)
export async function GET(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const contact = await prisma.contact.findFirst({
    where: { id, ...ownerWhere(owner.userId) },
    include: { notes: { orderBy: { createdAt: "desc" } } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(
    parseCustomFields(contact as unknown as Record<string, unknown>)
  );
}

// PATCH /api/contacts/:id
export async function PATCH(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const valid = validateContact(body, { partial: true });
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }

  const data: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(valid.data)) {
    if (key === "customFields") {
      data.customFields = value ? JSON.stringify(value) : null;
    } else {
      data[key] = (value as string | null) ?? null;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  // Scope the update to the owner so users can't modify others' contacts.
  const result = await prisma.contact.updateMany({
    where: { id, ...ownerWhere(owner.userId) },
    data,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const contact = await prisma.contact.findUnique({ where: { id } });
  // editing fields can shift the relationship signals — refresh the health score
  await recalculateHealth(id).catch(() => {});
  return NextResponse.json(
    parseCustomFields(contact as unknown as Record<string, unknown>)
  );
}

// DELETE /api/contacts/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { id } = await params;
  const result = await prisma.contact.deleteMany({
    where: { id, ...ownerWhere(owner.userId) },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
