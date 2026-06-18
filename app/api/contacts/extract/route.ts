import { NextRequest, NextResponse } from "next/server";
import { extractContact } from "@/lib/extract";
import { resolveOwner } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { truncateToBudget } from "@/lib/textBudget";

// Token budget for the story sent to the model. Matches the prior ~16k-char cap
// (≈4k tokens) but now truncates instead of rejecting, so a long paste still
// works — we just analyze the head and tell the caller it was shortened.
const STORY_TOKEN_BUDGET = 4000;

// This endpoint triggers a paid AI call, so cap how often a single caller can
// hit it. Best-effort, in-memory (see lib/rate-limit.ts).
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per minute

// POST /api/contacts/extract — parse freeform text (typed or dictated) into
// structured contact fields for review. Does NOT persist anything.
export async function POST(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const rl = rateLimit(`extract:${clientKey(req, owner.userId)}`, {
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

  const body = await req.json().catch(() => null);
  const raw = typeof body?.text === "string" ? body.text.trim() : "";

  // Photos (business cards, screenshots…) arrive as base64 data URLs. Cap the
  // count and per-image size so a single request can't blow the body limit or
  // the vision token budget. Anything malformed is silently dropped.
  const MAX_IMAGES = 4;
  const MAX_IMAGE_CHARS = 8_000_000; // ~6MB decoded per image
  const images: string[] = Array.isArray(body?.images)
    ? body.images
        .filter(
          (s: unknown): s is string =>
            typeof s === "string" &&
            /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s) &&
            s.length <= MAX_IMAGE_CHARS
        )
        .slice(0, MAX_IMAGES)
    : [];

  if (!raw && images.length === 0) {
    return NextResponse.json(
      { error: "text or at least one image is required" },
      { status: 400 }
    );
  }
  // Guard the AI call against runaway input: truncate to a token budget rather
  // than reject, so a long brain-dump still extracts (we analyze the head).
  const { text, truncated } = truncateToBudget(raw, STORY_TOKEN_BUDGET);
  const enrich = body?.enrich === true;

  try {
    const { fields, model, enriched, enrichedContact, enrichedContactSources, sources } =
      await extractContact(text, { enrich, images });
    return NextResponse.json({
      fields,
      model,
      enriched,
      enrichedContact,
      enrichedContactSources,
      sources,
      truncated,
    });
  } catch (err) {
    console.error("Contact extraction failed:", err);
    return NextResponse.json(
      { error: "Extraction failed. The AI service may be unavailable — please try again." },
      { status: 502 }
    );
  }
}
