-- Add photo attachments to notes. Additive + non-breaking: nullable-equivalent
-- via a default empty array so existing rows stay valid. IF NOT EXISTS guards a
-- manual apply against the shared Supabase DB.
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
