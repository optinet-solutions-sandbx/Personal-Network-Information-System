import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner } from "@/lib/auth";
import { listWorkspacesForUser } from "@/lib/workspace";
import { validateWorkspaceCreate } from "@/lib/validation";

// GET /api/workspaces
// Lists every workspace the signed-in user belongs to (id, name, type, role)
// and flags the one currently selected (resolveOwner already applied the
// selection cookie). In open mode there's no user, so the list is empty.
export async function GET() {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  if (!owner.userId) return NextResponse.json({ workspaces: [], currentId: null });

  const workspaces = await listWorkspacesForUser(owner.userId);
  return NextResponse.json({ workspaces, currentId: owner.workspaceId });
}

// POST /api/workspaces  { name }
// Creates a new TEAM workspace owned by the caller. The caller becomes its
// owner. Does NOT switch into it — the client follows up with
// POST /api/workspaces/switch so all selection logic lives in one place.
export async function POST(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  if (!owner.userId) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = validateWorkspaceCreate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: { name: parsed.data.name, type: "team" },
      });
      await tx.workspaceMember.create({
        data: { userId: owner.userId!, workspaceId: ws.id, role: "owner" },
      });
      return ws;
    });
    return NextResponse.json(
      { id: workspace.id, name: workspace.name, type: workspace.type, role: "owner", avatar: null },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/workspaces failed:", err);
    return NextResponse.json(
      { error: "Could not create workspace. Please try again." },
      { status: 500 }
    );
  }
}
