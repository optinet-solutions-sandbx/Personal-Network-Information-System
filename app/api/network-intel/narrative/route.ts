import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";
import { loadNetworkStats } from "@/lib/network-intel-server";
import { generateNetworkNarrative } from "@/lib/network-intel";

// GET /api/network-intel/narrative -> { narrative, model }
// Slow path: recomputes stats (fast) then runs the AI narrative (slow). Split
// out so the main page can render immediately and stream this in afterwards.
export async function GET() {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const stats = await loadNetworkStats(owner.workspaceId);
  const { narrative, model } = await generateNetworkNarrative(stats);
  return NextResponse.json({ narrative, model });
}
