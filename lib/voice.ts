// Voice-recording helpers (Phase 3). Browser-only — import from client
// components. Recordings are stored in Supabase Storage (the "voice-notes"
// bucket), NOT inline in the DB, so the database stays lean. When Storage isn't
// configured the app degrades gracefully to transcript-only voice notes
// (mirrors the optional-Supabase pattern used elsewhere, see lib/auth.ts).

import { createClient } from "@/lib/supabase/client";

// Bucket name (created once via scripts/setup-storage.mjs).
export const VOICE_BUCKET = "voice-notes";

// Max recording length we keep, in milliseconds. A guard against runaway
// recordings ballooning storage — the UI also shows elapsed time.
export const MAX_RECORDING_MS = 5 * 60 * 1000;

// Storage is only usable when Supabase is configured (same env the auth/login
// flow needs). Without it we keep the transcript but skip the audio upload.
export function isVoiceStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// True when this browser can capture audio at all.
export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

// Pick a mime type the browser actually supports, preferring compact webm/opus.
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

// A tiny recorder wrapper around MediaRecorder. start() opens the mic; stop()
// resolves with the recorded Blob (or null if nothing was captured).
export type Recorder = {
  stop: () => Promise<Blob | null>;
  cancel: () => void;
  mimeType: string;
};

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.start();

  const cleanup = () => stream.getTracks().forEach((t) => t.stop());

  return {
    mimeType: rec.mimeType || mimeType || "audio/webm",
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        rec.onstop = () => {
          cleanup();
          resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || "audio/webm" }) : null);
        };
        if (rec.state !== "inactive") rec.stop();
        else {
          cleanup();
          resolve(null);
        }
      }),
    cancel: () => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* noop */
      }
      cleanup();
    },
  };
}

function extFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

// Upload a recording to Supabase Storage and return its public URL. Returns null
// (never throws) when Storage isn't configured or the upload fails — callers
// then save the note transcript-only.
export async function uploadVoiceRecording(
  blob: Blob,
  contactId: string
): Promise<string | null> {
  if (!isVoiceStorageConfigured()) return null;
  try {
    const supabase = createClient();
    const ext = extFor(blob.type);
    const path = `${contactId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from(VOICE_BUCKET)
      .upload(path, blob, { contentType: blob.type || "audio/webm", upsert: false });
    if (error) {
      console.error("voice upload failed:", error.message);
      return null;
    }
    const { data } = supabase.storage.from(VOICE_BUCKET).getPublicUrl(path);
    return data.publicUrl ?? null;
  } catch (err) {
    console.error("voice upload threw:", err);
    return null;
  }
}
