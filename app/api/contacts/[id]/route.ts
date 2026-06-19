import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace";

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

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const contact = await prisma.contact.findUnique({
    where: { id, workspaceId: ctx.workspaceId },
    include: { notes: { orderBy: { createdAt: "desc" } } },
  });
  if (!contact) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(
    parseCustomFields(contact as unknown as Record<string, unknown>)
  );
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

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  if ("customFields" in body) {
    if (
      body.customFields &&
      typeof body.customFields === "object" &&
      Object.keys(body.customFields).length > 0
    ) {
      data.customFields = JSON.stringify(body.customFields);
    } else {
      data.customFields = null;
    }
  }

  try {
    const contact = await prisma.contact.update({
      where: { id, workspaceId: ctx.workspaceId },
      data,
    });
    return NextResponse.json(
      parseCustomFields(contact as unknown as Record<string, unknown>)
    );
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await prisma.contact.delete({ where: { id, workspaceId: ctx.workspaceId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
