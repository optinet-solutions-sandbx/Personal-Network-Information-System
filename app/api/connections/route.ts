import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";
import { isEncryptionConfigured } from "@/lib/crypto";
import { listConnectors } from "@/lib/connectors/registry";
import { listConnections } from "@/lib/connectors/store";

// GET /api/connections
// Returns every known provider with its configuration + connection state for
// the signed-in workspace. Never includes tokens.
export async function GET() {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const encryptionReady = isEncryptionConfigured();
  // Degrade gracefully if the Connection table hasn't been migrated yet (shared
  // DB / additive-migration pattern): show providers as not-yet-connected rather
  // than 500ing the page.
  const connections = await listConnections(owner).catch((err) => {
    console.error("GET /api/connections: could not read connections:", err);
    return [];
  });
  const byProvider = new Map(connections.map((c) => [c.provider, c]));

  const providers = listConnectors().map((c) => {
    const conn = byProvider.get(c.id);
    return {
      id: c.id,
      label: c.label,
      authMode: c.authMode,
      // A provider is usable only when BOTH its own config (OAuth creds, or
      // nothing for token mode) and the token encryption key are present.
      configured: c.isConfigured() && encryptionReady,
      connected: Boolean(conn),
      accountLabel: conn?.accountLabel ?? null,
      status: conn?.status ?? null,
      lastError: conn?.lastError ?? null,
      lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
      connectedAt: conn?.createdAt.toISOString() ?? null,
    };
  });

  return NextResponse.json({ encryptionReady, providers });
}
