-- Phase 3: generic file attachments on contacts and notes (Supabase Storage).
-- ADDITIVE and NON-DESTRUCTIVE: one new table only — no existing column is
-- dropped or altered. IF [NOT] EXISTS / DO-block guards make a manual apply
-- against the shared Supabase DB re-runnable (see the shared-DB migration-drift
-- landmine). The file bytes live in Storage; this table only holds metadata.

-- CreateTable: attachment metadata (bytes are in the "attachments" bucket)
CREATE TABLE IF NOT EXISTS "Attachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "contactId" TEXT NOT NULL,
    "noteId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Attachment_contactId_idx" ON "Attachment"("contactId");
CREATE INDEX IF NOT EXISTS "Attachment_noteId_idx" ON "Attachment"("noteId");
CREATE INDEX IF NOT EXISTS "Attachment_workspaceId_idx" ON "Attachment"("workspaceId");

-- AddForeignKey (guarded so a manual re-apply doesn't error)
DO $$ BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
