import { NextRequest, NextResponse } from "next/server";
import { extractContact } from "@/lib/extract";
import { getWorkspaceContext } from "@/lib/workspace";

// POST /api/contacts/extract — parse freeform text (typed or dictated) into
// structured contact fields for review. Does NOT persist anything.
export async function POST(req: NextRequest) {
  const ctx = getWorkspaceContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const { fields, model } = await extractContact(text);
  return NextResponse.json({ fields, model });
}
