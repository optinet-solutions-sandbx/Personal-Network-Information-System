import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import {
  computeNetworkStats,
  generateNetworkNarrative,
} from "@/lib/network-intel";
import type { Contact } from "@/lib/types";

// GET /api/network-intel -> { stats, narrative, model }
export async function GET() {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const where = ownerWhere(owner.userId);

  const [rows, connections] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: {
        id: true,
        name: true,
        company: true,
        location: true,
        tags: true,
        title: true,
        healthTier: true,
        birthday: true,
        createdAt: true,
        _count: { select: { notes: true } },
      },
    }),
    prisma.relationship.count({ where }),
  ]);

  // computeNetworkStats only reads the selected fields; cast to the shared shape.
  const contacts = rows as unknown as Contact[];
  const stats = computeNetworkStats(contacts, connections);
  const { narrative, model } = await generateNetworkNarrative(stats);

  return NextResponse.json({ stats, narrative, model });
}
