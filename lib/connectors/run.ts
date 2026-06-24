// Run a sync for a single stored connection. Shared by the user-triggered
// route (POST /[provider]/sync) and the scheduled cron job (/api/cron/sync), so
// both go through identical token-refresh, fetch, upsert, and status-update
// logic. No request/auth concerns here — callers handle those.

import type { Connection } from "@prisma/client";
import { getConnector } from "./registry";
import { getValidAccessToken, markSynced, markError } from "./store";
import { runSync, type SyncSummary } from "./sync";
import {
  defaultWindow,
  runEventSync,
  type EventSyncSummary,
} from "./calendar-sync";
import {
  TokenExpiredError,
  isCalendarCapable,
  type AccessContext,
  type Connector,
} from "./types";

export async function syncConnection(connection: Connection): Promise<SyncSummary> {
  const connector = getConnector(connection.provider);
  if (!connector) throw new Error(`unknown provider: ${connection.provider}`);

  try {
    const contacts = await withRefresh(connector, connection, (ctx) =>
      connector.fetchContacts(ctx)
    );
    const summary = await runSync(contacts, connector.id, {
      userId: connection.userId,
      workspaceId: connection.workspaceId,
    });
    await markSynced(connection.id);
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    await markError(connection.id, message).catch(() => {});
    throw err;
  }
}

// Sync calendar events for a connection whose provider is calendar-capable.
// Returns null for contact-only providers (HubSpot, Salesforce) so callers can
// skip them. Does NOT flip the connection's status — the contact sync owns that;
// this is best-effort alongside it.
export async function syncConnectionEvents(
  connection: Connection
): Promise<EventSyncSummary | null> {
  const connector = getConnector(connection.provider);
  if (!connector || !isCalendarCapable(connector)) return null;

  const window = defaultWindow();
  const events = await withRefresh(connector, connection, (ctx) =>
    connector.fetchEvents(ctx, window)
  );
  return runEventSync(events, connector.id, {
    userId: connection.userId,
    workspaceId: connection.workspaceId,
  });
}

// Run a fetch with the connection's access token, transparently refreshing it if
// the provider rejects it mid-flight (token revoked/rotated despite a future
// expiry) and retrying once. Shared by the contact and event fetch paths.
async function withRefresh<T>(
  connector: Connector,
  connection: Connection,
  fetcher: (ctx: AccessContext) => Promise<T>
): Promise<T> {
  const token = await getValidAccessToken(connection, connector);
  const ctx: AccessContext = { accessToken: token, apiBaseUrl: connection.apiBaseUrl };
  try {
    return await fetcher(ctx);
  } catch (err) {
    if (!(err instanceof TokenExpiredError) || !connection.refreshToken) throw err;
    // Force a refresh by treating the token as already expired, then retry once.
    const reloaded = { ...connection, expiresAt: new Date(0) } as Connection;
    const fresh = await getValidAccessToken(reloaded, connector);
    return fetcher({ accessToken: fresh, apiBaseUrl: reloaded.apiBaseUrl });
  }
}
