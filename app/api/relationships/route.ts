import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import {
  isRelationshipType,
  type ConnectionView,
  type GraphData,
} from "@/lib/relationships";

const CONTACT_SELECT = { id: true, name: true, title: true, company: true } as const;
const NOTE_MAX = 500;

// GET /api/relationships
//   ?contactId=<id>  -> connections for one contact (ConnectionView[])
//   ?graph=1         -> { nodes, edges } for the whole network graph
//   (none)           -> raw edges for the owner
export async function GET(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get("contactId");
  const graph = searchParams.get("graph");

  if (contactId) {
    // Confirm the contact is owned before exposing its edges.
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, ...ownerWhere(owner.workspaceId) },
      select: { id: true },
    });
    if (!contact) {
      return NextResponse.json({ error: "contact not found" }, { status: 404 });
    }

    const edges = await prisma.relationship.findMany({
      where: {
        ...ownerWhere(owner.workspaceId),
        OR: [{ fromId: contactId }, { toId: contactId }],
      },
      include: { from: { select: CONTACT_SELECT }, to: { select: CONTACT_SELECT } },
      orderBy: { createdAt: "desc" },
    });

    const views: ConnectionView[] = edges.map((e) => {
      const outgoing = e.fromId === contactId;
      const other = outgoing ? e.to : e.from;
      return {
        id: e.id,
        fromId: e.fromId,
        toId: e.toId,
        type: e.type as ConnectionView["type"],
        strength: e.strength,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
        outgoing,
        other,
      };
    });
    return NextResponse.json(views);
  }

  if (graph) {
    const edges = await prisma.relationship.findMany({
      where: ownerWhere(owner.workspaceId),
      select: { id: true, fromId: true, toId: true, type: true, strength: true, note: true, createdAt: true },
    });

    // Nodes = the contacts that appear in at least one edge.
    const ids = new Set<string>();
    const degree = new Map<string, number>();
    for (const e of edges) {
      ids.add(e.fromId);
      ids.add(e.toId);
      degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1);
      degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1);
    }
    const contacts = ids.size
      ? await prisma.contact.findMany({
          where: { id: { in: [...ids] }, ...ownerWhere(owner.workspaceId) },
          select: CONTACT_SELECT,
        })
      : [];

    const data: GraphData = {
      nodes: contacts.map((c) => ({ ...c, degree: degree.get(c.id) ?? 0 })),
      edges: edges.map((e) => ({
        id: e.id,
        fromId: e.fromId,
        toId: e.toId,
        type: e.type as GraphData["edges"][number]["type"],
        strength: e.strength,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
    };
    return NextResponse.json(data);
  }

  const edges = await prisma.relationship.findMany({
    where: ownerWhere(owner.workspaceId),
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(edges);
}

// POST /api/relationships  { fromId, toId, type, strength?, note? }
export async function POST(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const body = await req.json().catch(() => null);
  const fromId = typeof body?.fromId === "string" ? body.fromId : "";
  const toId = typeof body?.toId === "string" ? body.toId : "";
  const type = body?.type;

  if (!fromId || !toId) {
    return NextResponse.json({ error: "fromId and toId are required" }, { status: 400 });
  }
  if (fromId === toId) {
    return NextResponse.json({ error: "a contact can't connect to itself" }, { status: 400 });
  }
  if (!isRelationshipType(type)) {
    return NextResponse.json({ error: "invalid relationship type" }, { status: 400 });
  }

  let strength = 3;
  if (body?.strength != null) {
    const s = Number(body.strength);
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      return NextResponse.json({ error: "strength must be an integer 1–5" }, { status: 400 });
    }
    strength = s;
  }

  let note: string | null = null;
  if (body?.note != null) {
    if (typeof body.note !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }
    const trimmed = body.note.trim();
    if (trimmed.length > NOTE_MAX) {
      return NextResponse.json({ error: `note must be ≤ ${NOTE_MAX} characters` }, { status: 400 });
    }
    note = trimmed || null;
  }

  // Both endpoints must be contacts the owner can see.
  const found = await prisma.contact.findMany({
    where: { id: { in: [fromId, toId] }, ...ownerWhere(owner.workspaceId) },
    select: { id: true },
  });
  if (found.length !== 2) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  try {
    const edge = await prisma.relationship.upsert({
      where: { fromId_toId_type: { fromId, toId, type } },
      update: { strength, note },
      create: { userId: owner.userId, workspaceId: owner.workspaceId, fromId, toId, type, strength, note },
    });
    return NextResponse.json(edge, { status: 201 });
  } catch (err) {
    console.error("POST /api/relationships failed:", err);
    return NextResponse.json(
      { error: "Could not save connection. Please try again." },
      { status: 500 }
    );
  }
}
