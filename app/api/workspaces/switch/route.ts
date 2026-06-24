import { NextRequest, NextResponse } from "next/server";
import { resolveOwner, setWorkspaceSelection } from "@/lib/auth";
import { membershipRole } from "@/lib/workspace";
import { validateWorkspaceSwitch } from "@/lib/validation";

// POST /api/workspaces/switch  { workspaceId }
// Sets the selected-workspace cookie after confirming the caller is a member.
// resolveOwner reads this cookie on every request, so the switch re-scopes the
// whole app; the cookie also persists the "last selected workspace" choice.
export async function POST(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  if (!owner.userId) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = validateWorkspaceSwitch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const role = await membershipRole(owner.userId, parsed.data.workspaceId);
  if (!role) {
    return NextResponse.json({ error: "not a member of that workspace" }, { status: 403 });
  }

  await setWorkspaceSelection(parsed.data.workspaceId);
  return NextResponse.json({ ok: true, workspaceId: parsed.data.workspaceId, role });
}
