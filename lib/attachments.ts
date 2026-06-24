// File-attachment helpers (Phase 3). Browser-only — import from client
// components. Files are stored in Supabase Storage (the PRIVATE "attachments"
// bucket), NOT inline in the DB, so the database stays lean (mirrors the voice
// pattern in lib/voice.ts). The bytes go straight from the browser into the
// signed-in user's own folder — bypassing serverless request-body limits — and
// the Next API then records the file's metadata, mints signed download URLs,
// and handles deletion, all scoped to the authenticated user. When Storage
// isn't configured the feature is simply unavailable (degrades gracefully).

import { createClient } from "@/lib/supabase/client";

// Bucket name (created via prisma/storage-setup.sql -> npm run setup:storage).
export const ATTACHMENT_BUCKET = "attachments";

// Hard size cap, mirrored in prisma/storage-setup.sql (bucket file_size_limit)
// and the server-side metadata validator (lib/validation.ts).
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ATTACHMENT_MB = Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024));

// Storage is only usable when Supabase is configured (same env the auth/login
// flow needs). Without it the attach UI is hidden.
export function isAttachmentStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export type UploadedAttachment = {
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
};

// Reduce a filename to a safe storage-key segment while keeping it recognizable.
// The original, untouched filename is persisted separately as metadata and used
// for display + download — this only sanitizes the object key.
function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return cleaned.slice(0, 80) || "file";
}

// Upload one file into the signed-in user's folder and return its storage
// metadata for the caller to persist via the API. Returns null only when
// Storage isn't configured; throws (with a user-friendly message) on failure.
export async function uploadAttachment(
  file: File,
  contactId: string
): Promise<UploadedAttachment | null> {
  if (!isAttachmentStorageConfigured()) return null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to attach files.");

  const rand = Math.random().toString(36).slice(2, 8);
  // Folder layout: <auth.uid>/<contactId>/<ts>-<rand>-<name>. The leading uid
  // segment is what the Storage RLS policies key on (see storage-setup.sql).
  const path = `${user.id}/${contactId}/${Date.now()}-${rand}-${safeName(file.name)}`;
  const contentType = file.type || "application/octet-stream";

  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) throw new Error(error.message || "Upload failed.");

  return {
    storagePath: path,
    filename: file.name,
    mimeType: contentType,
    size: file.size,
  };
}
