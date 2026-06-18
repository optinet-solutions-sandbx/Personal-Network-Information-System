import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";

export async function POST() {
  const contacts = await prisma.contact.findMany({ select: { id: true } });

  for (const { id } of contacts) {
    await recalculateHealth(id);
  }

  return NextResponse.json({ updated: contacts.length });
}
