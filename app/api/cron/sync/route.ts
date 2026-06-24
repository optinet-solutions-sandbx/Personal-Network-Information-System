import { NextRequest, NextResponse } from "next/server";
import { listAllConnections } from "@/lib/connectors/store";
import { syncConnection, syncConnectionEvents } from "@/lib/connectors/run";

// Scheduled auto-sync. Triggered by the Vercel cron defined in vercel.json
// ("0 6 * * *" — daily 06:00 UTC). Pulls fresh contacts for EVERY connected
// account across all workspaces. Re-sync is idempotent (dedupe by externalId),
// so a daily run just refreshes provider-owned contacts.
//
// Auth: gated by CRON_SECRET. Vercel automatically sends
// `Authorization: Bearer <CRON_SECRET>` on cron invocations when the env var is
// set. With no secret configured the endpoint is disabled (401) so it can't be
// triggered by the public.
//
// Scaling caveat: syncs run sequentially within one invocation, bounded by the
// function timeout (maxDuration). Fine for a handful of connections; for many,
// move to a queue (QStash/Inngest) that fans out one job per connection.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connections = await listAllConnections().catch((err) => {
    console.error("cron/sync: could not list connections:", err);
    return [];
  });

  const results: Array<Record<string, unknown>> = [];
  for (const c of connections) {
    try {
      const summary = await syncConnection(c);
      // Calendar-capable providers (Google, Outlook) also refresh their event
      // cache. Best-effort: a calendar failure doesn't fail the contact sync.
      const events = await syncConnectionEvents(c).catch((err) => {
        console.error(`cron/sync: calendar sync for ${c.provider} failed:`, err);
        return null;
      });
      results.push({
        provider: c.provider,
        workspaceId: c.workspaceId,
        ok: true,
        ...summary,
        ...(events ? { events } : {}),
      });
    } catch (err) {
      results.push({
        provider: c.provider,
        workspaceId: c.workspaceId,
        ok: false,
        error: err instanceof Error ? err.message : "sync failed",
      });
    }
  }

  const synced = results.filter((r) => r.ok).length;
  return NextResponse.json({ ran: connections.length, synced, results });
}
