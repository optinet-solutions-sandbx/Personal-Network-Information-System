import { NextRequest, NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { getConnector } from "@/lib/connectors/registry";
import {
  getConnection,
  getValidAccessToken,
  markError,
  markSynced,
} from "@/lib/connectors/store";
import { runSync } from "@/lib/connectors/sync";
import { TokenExpiredError } from "@/lib/connectors/types";
import type { Connection } from "@prisma/client";
import type { Connector } from "@/lib/connectors/types";

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
    const contacts = await fetchWithRefresh(connector, connection);
    const summary = await runSync(contacts, connector.id, owner);
    await markSynced(connection.id);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    console.error(`Sync for ${connector.id} failed:`, err);
    await markError(connection.id, message).catch(() => {});
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

// Fetch contacts, transparently refreshing the access token if the provider
// rejects it mid-flight (token revoked/rotated despite a future expiry).
async function fetchWithRefresh(connector: Connector, connection: Connection) {
  const token = await getValidAccessToken(connection, connector);
  try {
    return await connector.fetchContacts(token);
  } catch (err) {
    if (!(err instanceof TokenExpiredError) || !connection.refreshToken) throw err;
    // Force a refresh by pretending the token is already expired, then retry once.
    const reloaded = { ...connection, expiresAt: new Date(0) } as Connection;
    const fresh = await getValidAccessToken(reloaded, connector);
    return connector.fetchContacts(fresh);
  }
}
