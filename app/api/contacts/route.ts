import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recalculateHealth } from "@/lib/health";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { validateContact, validateContactSource } from "@/lib/validation";

// Case-insensitive substring search (Postgres ILIKE under the hood).
const insensitive = (q: string) => ({ contains: q, mode: Prisma.QueryMode.insensitive });

// Pagination caps for the list endpoint.
const MAX_LIMIT = 200;

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

// GET /api/contacts?q=search&limit=&offset=
// Returns a JSON array of contacts (backward-compatible). When `limit` is
// supplied the result is a single page and pagination metadata is returned via
// the `X-Total-Count` and `X-Has-More` response headers. Without `limit`, all
// matching contacts are returned (used by the dashboard for aggregate stats).
export async function GET(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const params = req.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  // Restrict to contacts that have an AI-generated profile.
  const hasProfile = params.get("hasProfile") === "true";

  const limitRaw = params.get("limit");
  const limit =
    limitRaw != null
      ? Math.min(Math.max(parseInt(limitRaw, 10) || 0, 1), MAX_LIMIT)
      : null;
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  // Default ordering is most-recently-updated first (used by the dashboard's
  // "recent" section). `sort=name` switches to alphabetical, which the contacts
  // list uses so its A–Z grouping stays correct across paginated "Load more".
  const orderBy: Prisma.ContactOrderByWithRelationInput =
    params.get("sort") === "name"
      ? { name: "asc" }
      : { updatedAt: "desc" };

  const where: Prisma.ContactWhereInput = {
    ...ownerWhere(owner.userId),
    ...(hasProfile ? { profile: { not: null } } : {}),
    ...(q
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
      : {}),
  };

  const findArgs: Prisma.ContactFindManyArgs = {
    where,
    orderBy,
    include: { _count: { select: { notes: true } } },
    // The raw-source archive (esp. sourceImages data URLs) is large and only
    // ever read on the contact detail page — keep it out of the list payload.
    omit: { sourceText: true, sourceImages: true },
  };
  if (limit != null) {
    findArgs.skip = offset;
    findArgs.take = limit;
  }

  try {
    // Only pay for a count() when paginating.
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany(findArgs),
      limit != null ? prisma.contact.count({ where }) : Promise.resolve(0),
    ]);

    const body = contacts.map((c) =>
      parseCustomFields(c as unknown as Record<string, unknown>)
    );

    const headers: Record<string, string> = {};
    if (limit != null) {
      headers["X-Total-Count"] = String(total);
      headers["X-Has-More"] = String(offset + contacts.length < total);
    }

    return NextResponse.json(body, { headers });
  } catch (err) {
    // Surface the underlying cause (e.g. DB unreachable / schema drift) instead
    // of a bare 500 with an empty body, which is undebuggable in production.
    const code =
      err instanceof Prisma.PrismaClientKnownRequestError
        ? err.code
        : err instanceof Prisma.PrismaClientInitializationError
        ? err.errorCode ?? "init"
        : "unknown";
    console.error(`GET /api/contacts failed [${code}]:`, err);
    return NextResponse.json(
      {
        error: "Could not load contacts.",
        code,
        // Only expose the raw error message outside production.
        ...(process.env.NODE_ENV !== "production"
          ? { detail: err instanceof Error ? err.message : String(err) }
          : {}),
      },
      { status: 500 }
    );
  }
}

// POST /api/contacts
export async function POST(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const body = await req.json().catch(() => null);
  const valid = validateContact(body);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }
  const d = valid.data;

  // Optional immutable archive of the raw input this contact was created from.
  const src = validateContactSource(body);
  if (!src.ok) {
    return NextResponse.json({ error: src.error }, { status: 400 });
  }

  try {
    const contact = await prisma.contact.create({
      data: {
        userId: owner.userId,
        name: d.name!,
        email: d.email ?? null,
        phone: d.phone ?? null,
        company: d.company ?? null,
        title: d.title ?? null,
        location: d.location ?? null,
        tags: d.tags ?? null,
        birthday: d.birthday ?? null,
        howWeMet: d.howWeMet ?? null,
        customFields: d.customFields ? JSON.stringify(d.customFields) : null,
        sourceText: src.data.sourceText,
        sourceImages: src.data.sourceImages,
      },
    });

    await recalculateHealth(contact.id).catch(() => {});

    return NextResponse.json(
      parseCustomFields(contact as unknown as Record<string, unknown>),
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/contacts failed:", err);
    return NextResponse.json(
      { error: "Could not save contact. Please try again." },
      { status: 500 }
    );
  }
}
