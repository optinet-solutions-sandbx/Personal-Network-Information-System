import { NextRequest, NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { getConnector } from "@/lib/connectors/registry";
import { getConnection } from "@/lib/connectors/store";
import { syncConnection, syncConnectionEvents } from "@/lib/connectors/run";
import { TokenExpiredError } from "@/lib/connectors/types";

type Params = { params: Promise<{ provider: string }> };

// Pulling a whole CRM is expensive — keep it to a few per minute per user.
const SYNC_LIMIT = { limit: 5, windowMs: 60_000 };

// POST /api/connections/:provider/sync
// Pull contacts from the provider and upsert them (dedupe by externalId, then
// name+email). Refreshes the access token first if it's expired.
export async function POST(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { provider } = await params;
  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  const rl = rateLimit(`sync:${clientKey(req, owner.userId)}`, SYNC_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many syncs — please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const connection = await getConnection(owner, connector.id);
  if (!connection) {
    return NextResponse.json({ error: `${connector.label} is not connected` }, { status: 400 });
  }

  try {
    const summary = await syncConnection(connection);
    // For calendar-capable providers (Google, Outlook), also refresh the event
    // cache. Best-effort: a calendar hiccup shouldn't fail the contact sync the
    // user just asked for.
    const events = await syncConnectionEvents(connection).catch((err) => {
      console.error(`Calendar sync for ${connector.id} failed:`, err);
      return null;
    });
    return NextResponse.json(events ? { ...summary, events } : summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    console.error(`Sync for ${connector.id} failed:`, err);
    const reconnect = err instanceof TokenExpiredError || /reconnect required/.test(message);
    return NextResponse.json(
      {
        error: reconnect
          ? `${connector.label} needs to be reconnected.`
          : `Couldn't sync ${connector.label}. Please try again.`,
        reconnect,
      },
      { status: reconnect ? 401 : 502 }
    );
  }
}
