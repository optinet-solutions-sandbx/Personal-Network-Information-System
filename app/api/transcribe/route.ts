import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { resolveOwner } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rate-limit";

// Transcription is a paid AI call, so cap how often one caller can hit it.
// Best-effort, in-memory (see lib/rate-limit.ts) — mirrors /api/contacts/extract.
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per minute

// OpenAI's audio endpoints reject files over 25 MB. Enforce it here so an
// oversized upload fails fast with a clear message instead of a 400 from OpenAI.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Accept the common recorder/export formats OpenAI supports. A phone's native
// voice memo is typically m4a/mp4; browser MediaRecorder produces webm/ogg.
const ALLOWED_AUDIO = /^audio\/(mpeg|mp3|mp4|m4a|x-m4a|aac|wav|x-wav|webm|ogg|flac)/i;

// POST /api/transcribe — accept an uploaded audio recording (multipart form,
// field "file") and return its transcript. Lets the user dictate offline on
// their phone's recorder, then upload the file later to fill the composer.
// Does NOT persist the audio or the transcript.
export async function POST(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const rl = rateLimit(`transcribe:${clientKey(req, owner.userId)}`, {
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests — please slow down and try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfter),
          "RateLimit-Limit": String(rl.limit),
          "RateLimit-Remaining": String(rl.remaining),
          "RateLimit-Reset": String(Math.ceil(rl.resetAt / 1000)),
        },
      }
    );
  }

  // Unlike /extract there is no offline fallback for speech — without a key we
  // can't transcribe at all, so say so plainly.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Transcription isn't configured on this server (no AI key)." },
      { status: 503 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "An audio file is required." },
      { status: 400 }
    );
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "That recording is too large (max 25 MB). Trim it and try again." },
      { status: 413 }
    );
  }
  if (file.type && !ALLOWED_AUDIO.test(file.type)) {
    return NextResponse.json(
      { error: "Unsupported audio format. Try m4a, mp3, wav, webm, or ogg." },
      { status: 415 }
    );
  }

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
    const transcription = await client.audio.transcriptions.create({
      file,
      model,
    });
    return NextResponse.json({ text: transcription.text ?? "", model });
  } catch (err) {
    console.error("Audio transcription failed:", err);
    return NextResponse.json(
      { error: "Transcription failed. The AI service may be unavailable — please try again." },
      { status: 502 }
    );
  }
}
