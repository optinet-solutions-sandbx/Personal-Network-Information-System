import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOwner, ownerWhere } from "@/lib/auth";

// GET /api/notes
// Returns every note across the owner's contacts, newest first, each with a
// lightweight reference to its contact so the global Notes page can link back.
// Notes have no owner column of their own — they're scoped through the parent
// contact's `userId` via the relation filter.
export async function GET() {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  try {
    const notes = await prisma.note.findMany({
      where: { contact: ownerWhere(owner.workspaceId) },
      orderBy: { createdAt: "desc" },
      include: {
        contact: {
          select: { id: true, name: true, company: true, title: true },
        },
      },
    });
    return NextResponse.json(notes);
  } catch (err) {
    const code =
      err instanceof Prisma.PrismaClientKnownRequestError
        ? err.code
        : err instanceof Prisma.PrismaClientInitializationError
        ? err.errorCode ?? "init"
        : "unknown";
    console.error(`GET /api/notes failed [${code}]:`, err);
    return NextResponse.json(
      {
        error: "Could not load notes.",
        code,
        ...(process.env.NODE_ENV !== "production"
          ? { detail: err instanceof Error ? err.message : String(err) }
          : {}),
      },
      { status: 500 }
    );
  }
}
