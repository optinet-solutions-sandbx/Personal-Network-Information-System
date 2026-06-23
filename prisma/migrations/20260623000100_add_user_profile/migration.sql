-- Self-profile fields on User: the account holder's own info ("who I am"),
-- surfaced on /profile. ADDITIVE and NON-DESTRUCTIVE (nullable columns only).
-- IF NOT EXISTS guards keep a manual apply against the shared Supabase DB
-- re-runnable (see the shared-DB landmine in the project notes).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "company" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatar" TEXT;
