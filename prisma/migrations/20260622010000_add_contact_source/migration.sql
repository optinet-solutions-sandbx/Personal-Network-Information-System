-- Archive the original creation input on the contact itself. Additive +
-- non-breaking: both columns are nullable-equivalent (text is nullable, images
-- defaults to an empty array) so existing rows stay valid. IF NOT EXISTS guards
-- a manual apply against the shared Supabase DB.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "sourceText" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "sourceImages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
