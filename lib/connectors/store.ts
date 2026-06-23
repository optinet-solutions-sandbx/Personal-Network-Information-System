// Persistence + token lifecycle for connected accounts. Keeps the route
// handlers thin and is the ONLY place that encrypts/decrypts tokens or talks to
// the Connection table, so the encryption boundary is easy to audit.

import type { Connection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { AccountInfo, Connector, ProviderId, TokenSet } from "./types";

export type Scope = { userId: string | null; workspaceId: string | null };

// Public, token-free view of a connection for the UI.
export type ConnectionView = {
  provider: string;
  status: string;
  accountLabel: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  connectedAt: string;
};

export function toView(c: Connection): ConnectionView {
  return {
    provider: c.provider,
    status: c.status,
    accountLabel: c.accountLabel,
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    lastError: c.lastError,
    connectedAt: c.createdAt.toISOString(),
  };
}

// Find the connection for a provider within the owner's workspace. Uses
// findFirst (not the unique key) because workspaceId is nullable in open mode,
// where Postgres treats NULLs as distinct.
export function getConnection(
  scope: Scope,
  provider: ProviderId
): Promise<Connection | null> {
  return prisma.connection.findFirst({
    where: { provider, workspaceId: scope.workspaceId },
  });
}

export function listConnections(scope: Scope): Promise<Connection[]> {
  return prisma.connection.findMany({
    where: { workspaceId: scope.workspaceId },
  });
}

// Insert or replace the connection for (workspace, provider) with a fresh grant.
export async function saveConnection(
  scope: Scope,
  provider: ProviderId,
  tokens: TokenSet,
  account: AccountInfo
): Promise<void> {
  const existing = await getConnection(scope, provider);
  const data = {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    provider,
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    expiresAt: tokens.expiresAt ?? null,
    scope: tokens.scope ?? null,
    externalAccountId: account.externalAccountId,
    accountLabel: account.label,
    status: "connected",
    lastError: null,
  };
  if (existing) {
    await prisma.connection.update({ where: { id: existing.id }, data });
  } else {
    await prisma.connection.create({ data });
  }
}

export async function deleteConnection(scope: Scope, provider: ProviderId): Promise<boolean> {
  const existing = await getConnection(scope, provider);
  if (!existing) return false;
  await prisma.connection.delete({ where: { id: existing.id } });
  return true;
}

export async function markSynced(id: string): Promise<void> {
  await prisma.connection.update({
    where: { id },
    data: { lastSyncedAt: new Date(), status: "connected", lastError: null },
  });
}

export async function markError(id: string, message: string): Promise<void> {
  await prisma.connection.update({
    where: { id },
    data: { status: "error", lastError: message.slice(0, 500) },
  });
}

const EXPIRY_SKEW_MS = 60_000; // refresh a minute early to avoid edge-of-expiry 401s

// Return a usable access token for a connection, refreshing it first when it's
// expired (or about to be) and a refresh token is available. Persists the new
// tokens. Throws if no refresh is possible and the token is expired.
export async function getValidAccessToken(
  connection: Connection,
  connector: Connector
): Promise<string> {
  const expired =
    connection.expiresAt != null &&
    connection.expiresAt.getTime() - EXPIRY_SKEW_MS <= Date.now();

  if (!expired) return decryptSecret(connection.accessToken);

  if (!connection.refreshToken) {
    throw new Error("connection token expired and no refresh token is available — reconnect required");
  }

  const refreshed = await connector.refresh(decryptSecret(connection.refreshToken));
  await prisma.connection.update({
    where: { id: connection.id },
    data: {
      accessToken: encryptSecret(refreshed.accessToken),
      // HubSpot/Google may omit a new refresh token — keep the existing one.
      refreshToken: refreshed.refreshToken
        ? encryptSecret(refreshed.refreshToken)
        : connection.refreshToken,
      expiresAt: refreshed.expiresAt ?? null,
      scope: refreshed.scope ?? connection.scope,
    },
  });
  return refreshed.accessToken;
}

// Absolute origin for building OAuth redirect URIs. Prefers an explicit env
// override (set this on Vercel so it matches the URL registered in the provider
// app), else derives from the incoming request.
export function appOrigin(req: { url: string; headers: { get(n: string): string | null } }): string {
  const override = process.env.APP_ORIGIN?.trim();
  if (override) return override.replace(/\/$/, "");
  // Behind a proxy (Vercel), trust the forwarded host/proto. Locally there's no
  // x-forwarded-host, so fall back to the request URL's own origin — which keeps
  // the correct http://localhost:3000 scheme for dev (don't assume https).
  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdHost) {
    const proto = req.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${fwdHost}`;
  }
  return new URL(req.url).origin;
}

export function redirectUriFor(req: { url: string; headers: { get(n: string): string | null } }, provider: ProviderId): string {
  return `${appOrigin(req)}/api/connections/${provider}/callback`;
}
