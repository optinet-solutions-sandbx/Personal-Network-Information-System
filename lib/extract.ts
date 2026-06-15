import OpenAI from "openai";
import type { ContactInput } from "@/lib/types";

export type ExtractResult = {
  /** Best-effort structured fields parsed from the freeform input. */
  fields: ContactInput;
  /** Which extractor produced the result: the model id, or "fallback". */
  model: string;
};

const SYSTEM_PROMPT = `You extract structured contact details from freeform text
(typed notes or a transcribed voice message) for a relationship-management app.

Return ONLY a JSON object with these keys (all optional except "name"):
- name: the person's full name
- title: their job title / role
- company: the organization they work for
- email: email address
- phone: phone number
- location: city / region
- tags: comma-separated short keywords describing them (e.g. "investor, fintech, warm-lead")
- howWeMet: where or how the connection was made

The text may come from imperfect speech-to-text, so repair common dictation artifacts:
- Reconstruct emails from spoken form: "at" -> "@", "dot"/"period" -> ".". Words that
  are clearly mis-heard separators inside an email (e.g. "that" between name parts) should
  become ".". Strip spaces and ensure the result contains exactly one "@".
- For phone numbers, keep only the digits (and a leading "+" if present); collapse stray
  hyphens/spaces from mis-grouped dictation into a single sensible number.

Rules:
- Use "" (empty string) for any field you cannot determine. Do not guess or invent facts.
- Normalize the name to proper case. Apply the dictation repairs above to phone/email,
  but otherwise keep them faithful to what was said.
- "tags" should be a single comma-separated string, not an array.
- Output valid JSON only, no markdown fences, no commentary.`;

const FIELD_KEYS: (keyof ContactInput)[] = [
  "name",
  "title",
  "company",
  "email",
  "phone",
  "location",
  "tags",
  "howWeMet",
];

function emptyFields(): ContactInput {
  return {
    name: "",
    title: "",
    company: "",
    email: "",
    phone: "",
    location: "",
    tags: "",
    howWeMet: "",
  };
}

/** Coerce arbitrary parsed JSON into a clean ContactInput (strings only, trimmed). */
function normalize(raw: unknown): ContactInput {
  const out = emptyFields();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of FIELD_KEYS) {
    const v = obj[key];
    if (typeof v === "string") out[key] = v.trim();
    else if (Array.isArray(v)) out[key] = v.map(String).join(", ").trim();
  }
  return out;
}

// Deterministic fallback so the feature is demonstrable without an API key.
// Best-effort: pulls email/phone via regex and guesses a name from the start.
function buildFallback(text: string): ContactInput {
  const fields = emptyFields();

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) fields.email = email[0];

  const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phone) fields.phone = phone[0].trim();

  // Name heuristic: first run of 1-3 capitalized words near the start.
  const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/);
  if (nameMatch) fields.name = nameMatch[1];

  return fields;
}

export async function extractContact(text: string): Promise<ExtractResult> {
  const input = text.trim();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { fields: buildFallback(input), model: "fallback" };
  }

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return { fields: buildFallback(input), model: "fallback" };
    const parsed = JSON.parse(raw);
    return { fields: normalize(parsed), model: completion.model || model };
  } catch (err) {
    console.error("OpenAI contact extraction failed, using fallback:", err);
    return { fields: buildFallback(input), model: "fallback" };
  }
}
