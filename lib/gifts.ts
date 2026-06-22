import OpenAI from "openai";
import type { GiftSuggestion } from "@/lib/types";

export type GiftsInput = {
  name: string;
  title?: string | null;
  company?: string | null;
  howWeMet?: string | null;
  customFields?: Record<string, string> | null;
  recentNotes: string[];
};

const SYSTEM_PROMPT = `You are a thoughtful gift advisor helping someone choose a birthday gift for a contact.
Given the contact's profile details and recent notes, suggest exactly 3 personalized gift ideas.
Return ONLY a JSON object in this exact shape, no markdown fences:
{"suggestions":[{"title":"...","rationale":"..."},{"title":"...","rationale":"..."},{"title":"...","rationale":"..."}]}
Each rationale must be 1-2 sentences tying the gift directly to something specific you know about the person.
Be specific. Do not invent facts not present in the input.`;

function buildUserMessage(input: GiftsInput): string {
  const fields = [
    ["Name", input.name],
    ["Title", input.title],
    ["Company", input.company],
    ["How we met", input.howWeMet],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const custom = input.customFields
    ? Object.entries(input.customFields)
        .filter(([, v]) => v)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")
    : "";

  const notes = input.recentNotes.length
    ? input.recentNotes.map((n, i) => `Note ${i + 1}: ${n}`).join("\n")
    : "(no notes yet)";

  return [
    "Contact details:",
    fields || "(none)",
    custom ? `\nAdditional info:\n${custom}` : "",
    `\nRecent notes:\n${notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallback(input: GiftsInput): GiftSuggestion[] {
  const interests = (
    input.customFields?.Interests ||
    input.customFields?.Hobbies ||
    ""
  ).toLowerCase();

  const profession = [input.title, input.company].filter(Boolean).join(" at ") || "professional";
  const suggestions: GiftSuggestion[] = [];

  if (interests.includes("coffee")) {
    suggestions.push({
      title: "Specialty Coffee Subscription",
      rationale: `${input.name} is interested in coffee — a curated single-origin subscription makes a personal and practical gift.`,
    });
  }

  if (interests.includes("book") || interests.includes("read")) {
    suggestions.push({
      title: "Curated Book in Their Field",
      rationale: `${input.name} enjoys reading — a well-chosen book aligned with their work or interests shows thoughtfulness.`,
    });
  }

  if (interests.includes("tech") || interests.includes("software") || interests.includes("code")) {
    suggestions.push({
      title: "Mechanical Keyboard or Desk Accessory",
      rationale: `As someone in tech, ${input.name} would appreciate a quality desk upgrade for their workspace.`,
    });
  }

  const backfill: GiftSuggestion[] = [
    {
      title: "Premium Notebook & Pen Set",
      rationale: `A quality notebook is a thoughtful everyday gift for any ${profession}.`,
    },
    {
      title: "Streaming or Learning Platform Gift Card",
      rationale: `Gives ${input.name} the flexibility to pick content that fits their schedule and interests.`,
    },
    {
      title: "Artisan Food & Drink Gift Box",
      rationale: `A curated gourmet selection is a universally appreciated birthday gesture.`,
    },
  ];

  for (const g of backfill) {
    if (suggestions.length >= 3) break;
    suggestions.push(g);
  }

  return suggestions.slice(0, 3);
}

// Suggestions plus the source that produced them, so the UI can attribute the
// content ("rule-based" = the deterministic fallback, no AI call).
export type GiftResult = { suggestions: GiftSuggestion[]; model: string };

export async function generateGiftSuggestions(
  input: GiftsInput
): Promise<GiftResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { suggestions: buildFallback(input), model: "rule-based" };

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return { suggestions: buildFallback(input), model: "rule-based" };
    const parsed = JSON.parse(text) as { suggestions: GiftSuggestion[] };
    if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
      return { suggestions: buildFallback(input), model: "rule-based" };
    }
    return { suggestions: parsed.suggestions.slice(0, 3), model };
  } catch (err) {
    console.error("OpenAI gift generation failed, using fallback:", err);
    return { suggestions: buildFallback(input), model: "rule-based" };
  }
}
