-- Phase 3 connectors (D7): contact provenance + connected-accounts table.
-- ADDITIVE and NON-DESTRUCTIVE (nullable columns, new table, indexes only).
-- IF [NOT] EXISTS guards make a manual apply against the shared Supabase DB
-- re-runnable (see the shared-DB landmine in the project notes).

-- Provenance on Contact: origin system + that system's record id, for re-sync
-- dedupe. Existing rows get source = 'manual'.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'manual';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

CREATE INDEX IF NOT EXISTS "Contact_workspaceId_source_externalId_idx"
  ON "Contact"("workspaceId", "source", "externalId");

-- Connected accounts: one OAuth grant per (workspace, provider). Tokens are
-- stored encrypted at rest by the application (AES-256-GCM); the DB just holds
-- ciphertext strings.
CREATE TABLE IF NOT EXISTS "Connection" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT,
  "workspaceId"       TEXT,
  "provider"          TEXT NOT NULL,
  "accessToken"       TEXT NOT NULL,
  "refreshToken"      TEXT,
  "expiresAt"         TIMESTAMP(3),
  "scope"             TEXT,
  "externalAccountId" TEXT,
  "accountLabel"      TEXT,
  "status"            TEXT NOT NULL DEFAULT 'connected',
  "lastError"         TEXT,
  "lastSyncedAt"      TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Connection_workspaceId_provider_key"
  ON "Connection"("workspaceId", "provider");
CREATE INDEX IF NOT EXISTS "Connection_workspaceId_idx" ON "Connection"("workspaceId");
CREATE INDEX IF NOT EXISTS "Connection_userId_idx" ON "Connection"("userId");
