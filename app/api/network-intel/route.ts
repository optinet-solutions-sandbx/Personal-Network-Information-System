import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";
import { loadNetworkStats } from "@/lib/network-intel-server";

// GET /api/network-intel -> { stats }
// Fast path: pure DB aggregation, no AI. The (slow) AI narrative is fetched
// separately from /api/network-intel/narrative so the page renders instantly.
export async function GET() {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const stats = await loadNetworkStats(owner.workspaceId);
  return NextResponse.json({ stats });
}
