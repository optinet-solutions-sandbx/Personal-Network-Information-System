-- Phase 3: voice recordings + AI summaries on notes, and the relationship
-- ("who knows whom") graph. ADDITIVE and NON-DESTRUCTIVE: new nullable columns
-- and one new table only — no existing column is dropped or altered.
-- IF [NOT] EXISTS / DO-block guards make a manual apply against the shared
-- Supabase DB re-runnable (see the shared-DB migration-drift landmine).

-- AlterTable: voice recording URL + AI summary on notes (both nullable)
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "audioUrl" TEXT;
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "summary" TEXT;

-- CreateTable: relationship edges
CREATE TABLE IF NOT EXISTS "Relationship" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'knows',
    "strength" INTEGER NOT NULL DEFAULT 3,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Relationship_fromId_toId_type_key" ON "Relationship"("fromId", "toId", "type");
CREATE INDEX IF NOT EXISTS "Relationship_userId_idx" ON "Relationship"("userId");
CREATE INDEX IF NOT EXISTS "Relationship_fromId_idx" ON "Relationship"("fromId");
CREATE INDEX IF NOT EXISTS "Relationship_toId_idx" ON "Relationship"("toId");

-- AddForeignKey (guarded so a manual re-apply doesn't error)
DO $$ BEGIN
  ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
