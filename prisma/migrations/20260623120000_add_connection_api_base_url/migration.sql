-- Salesforce (and any per-instance provider) returns a per-org API base
-- (instance_url) at auth time. Store it on the connection. ADDITIVE + nullable;
-- IF NOT EXISTS guards a manual apply against the shared Supabase DB.
ALTER TABLE "Connection" ADD COLUMN IF NOT EXISTS "apiBaseUrl" TEXT;
