-- Voice-notes Supabase Storage setup (Phase 3). Idempotent — safe to re-run.
-- Creates the public "voice-notes" bucket and the access policies the browser
-- upload (lib/voice.ts) needs. Run with: npm run setup:storage
--
-- Why policies: a "public" bucket only makes objects publicly READABLE. Uploads
-- (inserts into storage.objects) still require an explicit policy. Voice notes
-- are only recorded when Supabase auth is configured, so the uploader is always
-- the `authenticated` role.

-- 1) The bucket (public read; 20MB cap; audio mime types only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-notes', 'voice-notes', true, 20971520,
        array['audio/webm', 'audio/mp4', 'audio/ogg'])
on conflict (id) do update
  set public            = true,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Allow signed-in users to upload into the bucket.
drop policy if exists "voice-notes authenticated upload" on storage.objects;
create policy "voice-notes authenticated upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'voice-notes');

-- 3) Public read (recordings are served via their public URL stored on the Note).
drop policy if exists "voice-notes public read" on storage.objects;
create policy "voice-notes public read" on storage.objects
  for select to public
  using (bucket_id = 'voice-notes');

-- ---------------------------------------------------------------------------
-- Generic file attachments on contacts/notes (lib/attachments.ts).
--
-- Unlike voice notes, attachments can be private documents, so this bucket is
-- PRIVATE: objects are never publicly readable and are only reachable through
-- short-lived signed URLs the API mints per request (GET /api/attachments/:id).
-- Access is scoped per user: every object lives under a "<auth.uid>/..." folder
-- and the policies below only let a signed-in user touch files in their OWN
-- folder. The Next API additionally enforces workspace ownership on the
-- metadata row, so this is defense-in-depth.
-- ---------------------------------------------------------------------------

-- 4) The bucket (PRIVATE; 25MB cap; any mime type — attachments are arbitrary).
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do update
  set public          = false,
      file_size_limit = excluded.file_size_limit;

-- 5) Upload into your own folder (path must start with <auth.uid>/).
drop policy if exists "attachments owner upload" on storage.objects;
create policy "attachments owner upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6) Read your own files (required for the API to mint signed download URLs).
drop policy if exists "attachments owner read" on storage.objects;
create policy "attachments owner read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 7) Delete your own files.
drop policy if exists "attachments owner delete" on storage.objects;
create policy "attachments owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
