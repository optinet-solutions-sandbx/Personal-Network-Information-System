import { NextRequest, NextResponse } from "next/server";
import { extractContact } from "@/lib/extract";
import { resolveOwner } from "@/lib/auth";
import { LIMITS } from "@/lib/validation";

// POST /api/contacts/extract — parse freeform text (typed or dictated) into
// structured contact fields for review. Does NOT persist anything.
export async function POST(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  // Cap the prompt size — guards the AI call against runaway input.
  const MAX_TEXT = LIMITS.howWeMet * 4;
  if (text.length > MAX_TEXT) {
    return NextResponse.json(
      { error: "That's a lot of text — please shorten it and try again." },
      { status: 400 }
    );
  }
  const enrich = body?.enrich === true;

  try {
    const { fields, model, enriched, enrichedContact, sources } =
      await extractContact(text, { enrich });
    return NextResponse.json({
      fields,
      model,
      enriched,
      enrichedContact,
      sources,
    });
  } catch (err) {
    console.error("Contact extraction failed:", err);
    return NextResponse.json(
      { error: "Extraction failed. The AI service may be unavailable — please try again." },
      { status: 502 }
    );
  }
}
