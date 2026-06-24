-- Workspace Management epic: workspace profile fields + shareable invite links.
-- ADDITIVE and NON-DESTRUCTIVE: two new nullable columns on Workspace and one
-- new table. IF [NOT] EXISTS / DO-block guards make a manual apply against the
-- shared Supabase DB re-runnable (see the shared-DB migration-drift landmine).

-- AlterTable: optional workspace profile (description + logo data URL)
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "avatar" TEXT;

-- CreateTable: shareable, multi-use invite links
CREATE TABLE IF NOT EXISTS "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'member',
    "createdByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceInvite_token_key" ON "WorkspaceInvite"("token");
CREATE INDEX IF NOT EXISTS "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");

-- AddForeignKey (guarded so a manual re-apply doesn't error)
DO $$ BEGIN
  ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
