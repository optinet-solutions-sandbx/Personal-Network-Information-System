import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/contacts/check?name=...&email=...
// Returns existing contacts that look like duplicates of the one about to be
// saved — a case-insensitive exact match on name OR email. Does NOT persist
// anything; the client uses this to prompt "merge or save anyway" before POST.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  const email = req.nextUrl.searchParams.get("email")?.trim();

  const or: object[] = [];
  if (name) or.push({ name: { equals: name, mode: "insensitive" } });
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });

  // Nothing to match on → no duplicates.
  if (or.length === 0) return NextResponse.json([]);

  const matches = await prisma.contact.findMany({
    where: { OR: or },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { notes: true } } },
    take: 5,
  });

  return NextResponse.json(matches);
}
