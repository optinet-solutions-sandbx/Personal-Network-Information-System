import OpenAI from "openai";

// AI summary of a (voice) note transcript. Used to give long dictated notes a
// one-line gist shown above the full text. Like the other AI features this is
// optional: with no OPENAI_API_KEY it falls back to a deterministic extractive
// summary, and very short notes get no summary at all (the text is its own gist).

export type SummaryResult = { summary: string | null; model: string };

// Below this length a note is already short enough to read at a glance — don't
// bother summarizing (and don't spend a token on it).
const MIN_LENGTH_TO_SUMMARIZE = 280;

const SYSTEM_PROMPT = `You condense a single spoken/dictated note into one short, plain sentence (max ~25 words) capturing the key point or action. No preamble, no markdown, no quotes — just the sentence. Ground it strictly in the provided text; do not invent details.`;

// Deterministic fallback: first sentence (or first ~180 chars) of the transcript.
function extractiveFallback(text: string): string {
  const firstSentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  const base = firstSentence && firstSentence.length >= 30 ? firstSentence : text;
  const trimmed = base.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177).trimEnd()}…` : trimmed;
}

export async function summarizeTranscript(text: string): Promise<SummaryResult> {
  const content = text.trim();
  if (content.length < MIN_LENGTH_TO_SUMMARIZE) {
    return { summary: null, model: "none" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { summary: extractiveFallback(content), model: "fallback" };
  }

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: 80,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
    });
    const summary = completion.choices[0]?.message?.content?.trim();
    if (!summary) return { summary: extractiveFallback(content), model: "fallback" };
    return { summary, model: completion.model ?? model };
  } catch (err) {
    console.error("note summary generation failed, using fallback:", err);
    return { summary: extractiveFallback(content), model: "fallback" };
  }
}
