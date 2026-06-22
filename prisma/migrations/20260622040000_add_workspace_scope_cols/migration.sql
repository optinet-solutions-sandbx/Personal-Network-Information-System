-- Shared-team workspace scoping: add workspaceId to Suggestion and Relationship
-- so they can be scoped to a workspace like Contact already is. ADDITIVE and
-- NON-DESTRUCTIVE (nullable columns + indexes only). IF [NOT] EXISTS guards make
-- a manual apply against the shared Supabase DB re-runnable.

ALTER TABLE "Suggestion" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "Relationship" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

CREATE INDEX IF NOT EXISTS "Suggestion_workspaceId_idx" ON "Suggestion"("workspaceId");
CREATE INDEX IF NOT EXISTS "Relationship_workspaceId_idx" ON "Relationship"("workspaceId");
