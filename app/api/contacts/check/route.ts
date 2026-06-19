import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const name = req.nextUrl.searchParams.get("name")?.trim();
  const email = req.nextUrl.searchParams.get("email")?.trim();

  const or: object[] = [];
  if (name) or.push({ name: { equals: name, mode: "insensitive" } });
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });

  if (or.length === 0) return NextResponse.json([]);

  const matches = await prisma.contact.findMany({
    where: { workspaceId: ctx.workspaceId, OR: or },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { notes: true } } },
    take: 5,
  });

  return NextResponse.json(matches);
}
