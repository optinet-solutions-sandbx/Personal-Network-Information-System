import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner } from "@/lib/auth";
import { validateProfile } from "@/lib/validation";

// The User columns that make up the editable self-profile. Kept in one place so
// GET and PUT stay in sync and tokens/ids never leak into the payload.
const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  title: true,
  company: true,
  location: true,
  bio: true,
  website: true,
  phone: true,
  avatar: true,
} as const;

// GET /api/profile — the signed-in user's own profile.
// In open mode (no auth) there is no user, so `profile` is null.
export async function GET() {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) return NextResponse.json({ profile: null });

  try {
    // resolveOwner() has already upserted the User row (via the workspace
    // resolve), so it exists; findUnique keeps this a clean read either way.
    const profile = await prisma.user.findUnique({
      where: { id: owner.userId },
      select: PROFILE_SELECT,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("GET /api/profile failed:", err);
    return NextResponse.json(
      { error: "Could not load your profile." },
      { status: 500 }
    );
  }
}

// PUT /api/profile — partial update of the signed-in user's profile.
export async function PUT(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;
  if (!owner.userId) {
    return NextResponse.json(
      { error: "Sign in to edit your profile." },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const valid = validateProfile(body);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }

  try {
    const profile = await prisma.user.update({
      where: { id: owner.userId },
      data: valid.data,
      select: PROFILE_SELECT,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("PUT /api/profile failed:", err);
    return NextResponse.json(
      { error: "Could not save your profile. Please try again." },
      { status: 500 }
    );
  }
}
