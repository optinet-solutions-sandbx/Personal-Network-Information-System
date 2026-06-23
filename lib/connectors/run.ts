// Run a sync for a single stored connection. Shared by the user-triggered
// route (POST /[provider]/sync) and the scheduled cron job (/api/cron/sync), so
// both go through identical token-refresh, fetch, upsert, and status-update
// logic. No request/auth concerns here — callers handle those.

import type { Connection } from "@prisma/client";
import { getConnector } from "./registry";
import { getValidAccessToken, markSynced, markError } from "./store";
import { runSync, type SyncSummary } from "./sync";
import { TokenExpiredError, type AccessContext, type Connector } from "./types";

export async function syncConnection(connection: Connection): Promise<SyncSummary> {
  const connector = getConnector(connection.provider);
  if (!connector) throw new Error(`unknown provider: ${connection.provider}`);

  try {
    const contacts = await fetchWithRefresh(connector, connection);
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

// Fetch contacts, transparently refreshing the access token if the provider
// rejects it mid-flight (token revoked/rotated despite a future expiry).
async function fetchWithRefresh(connector: Connector, connection: Connection) {
  const token = await getValidAccessToken(connection, connector);
  const ctx: AccessContext = { accessToken: token, apiBaseUrl: connection.apiBaseUrl };
  try {
    return await connector.fetchContacts(ctx);
  } catch (err) {
    if (!(err instanceof TokenExpiredError) || !connection.refreshToken) throw err;
    // Force a refresh by treating the token as already expired, then retry once.
    const reloaded = { ...connection, expiresAt: new Date(0) } as Connection;
    const fresh = await getValidAccessToken(reloaded, connector);
    return connector.fetchContacts({ accessToken: fresh, apiBaseUrl: reloaded.apiBaseUrl });
  }
}
