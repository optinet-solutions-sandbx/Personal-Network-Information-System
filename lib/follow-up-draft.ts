import OpenAI from "openai"
import type { BriefingInput } from "./briefing"

// The two tones this generator can produce. "follow-up" re-engages an existing
// relationship; "hello" is a first greeting to a brand-new connection.
export type DraftKind = "follow-up" | "hello"

const SYSTEM_PROMPT = `You are a relationship-intelligence assistant helping someone stay in touch with their network.
Given contact details and recent notes, write a short, warm, personalized outreach message the user can send.

Guidelines:
- 2–4 sentences maximum
- Warm but not sycophantic
- Reference something specific from the notes or profile to show it's personal
- End with a natural open question or call to action
- Plain text only — no markdown, no subject line, no signature
- Write in first person as the user sending the message`

const HELLO_SYSTEM_PROMPT = `You are a relationship-intelligence assistant helping someone greet a brand-new connection they just added to their network.
Given contact details and any notes, write a short, warm first-hello message the user can send right after connecting.

Guidelines:
- 1–3 sentences maximum
- Warm and genuine — this is a first message, not a catch-up
- Convey that it's great to connect and that they look forward to staying in touch
- If there's a specific, natural detail (how they met, shared company/context), reference it lightly; otherwise keep it simple and don't invent anything
- Plain text only — no markdown, no subject line, no signature
- Write in first person as the user sending the message`

function buildUserMessage(input: BriefingInput): string {
  const fields = [
    ["Name", input.name],
    ["Title", input.title],
    ["Company", input.company],
    ["How we met", input.howWeMet],
    ["Tags", input.tags],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n")

  const notes = input.notes.slice(0, 5)
  const notesText = notes.length
    ? notes
        .map((n) => {
          const date = new Date(n.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
          return `(${date}): ${n.content}`
        })
        .join("\n")
    : "(no notes yet)"

  const profileSection = input.profile ? `\nProfile summary:\n${input.profile}` : ""

  return [`Contact:\n${fields || "(no details)"}`, profileSection, `Recent notes:\n${notesText}`]
    .filter(Boolean)
    .join("\n\n")
}

function buildFallback(input: BriefingInput): string {
  const atCompany = input.company ? ` at ${input.company}` : ""
  const recent = input.notes[0]?.content
  if (recent) {
    const snippet = recent.length > 80 ? `${recent.slice(0, 80)}…` : recent
    return `Hey ${input.name}, I was thinking about you${atCompany} and our last conversation — ${snippet} How have things been going?`
  }
  return `Hey ${input.name}, it's been a while and I wanted to reach out${atCompany ? ` — hope everything is going well there` : ""}. How have you been?`
}

function buildHelloFallback(input: BriefingInput): string {
  const atCompany = input.company ? ` (at ${input.company})` : ""
  return `Hi ${input.name}${atCompany}, it's great to connect! Looking forward to staying in touch.`
}

export async function generateFollowUpDraft(
  input: BriefingInput,
  kind: DraftKind = "follow-up"
): Promise<string> {
  const system = kind === "hello" ? HELLO_SYSTEM_PROMPT : SYSTEM_PROMPT
  const fallback = kind === "hello" ? buildHelloFallback(input) : buildFallback(input)

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fallback

  try {
    const client = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildUserMessage(input) },
      ],
    })
    const text = completion.choices[0]?.message?.content?.trim()
    return text || fallback
  } catch (err) {
    console.error("OpenAI follow-up draft failed, using fallback:", err)
    return fallback
  }
}
