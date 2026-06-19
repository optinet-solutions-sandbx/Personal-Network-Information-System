import Anthropic from "@anthropic-ai/sdk"
import type { Contact } from "./types"

export type IntroductionCandidate = {
  contactAId: string
  contactBId: string
  rationale: string
  score: number
}

const BUCKETS: Record<string, string[]> = {
  tech: [
    "engineer", "developer", "software", "web", "data", "devops", "cto",
    "programmer", "cloud", "backend", "frontend", "fullstack", "mobile",
    "ios", "android", "ml", "ai", "tech",
  ],
  marketing: [
    "marketing", "brand", "content", "seo", "social", "growth",
    "campaign", "communications", "pr", "copywriter",
  ],
  design: [
    "designer", "ux", "ui", "creative", "art director", "product design", "visual",
  ],
  sales: [
    "sales", "account", "business development", "bdr", "sdr", "revenue", "partnerships",
  ],
  finance: [
    "finance", "accounting", "cfo", "investment", "banker", "analyst", "vc", "capital",
  ],
  legal: ["lawyer", "attorney", "legal", "counsel", "compliance", "paralegal"],
  operations: [
    "operations", "ops", "logistics", "supply chain", "project manager", "program manager",
  ],
  hr: ["hr", "human resources", "recruiter", "talent", "people ops", "people"],
  product: ["product manager", "product owner", "pm", "scrum", "agile", "product"],
  executive: ["ceo", "founder", "co-founder", "president", "vp", "director", "head of"],
}

// Pairs of buckets whose members could make valuable introductions across the boundary
const ADJACENT = new Set([
  "tech:design",
  "tech:product",
  "tech:sales",
  "marketing:design",
  "marketing:sales",
  "sales:operations",
  "finance:executive",
  "hr:executive",
  "product:design",
])

function assignBucket(contact: Contact): string {
  const text = [contact.title ?? "", contact.tags ?? ""].join(" ").toLowerCase()
  for (const [bucket, keywords] of Object.entries(BUCKETS)) {
    if (keywords.some((kw) => text.includes(kw))) return bucket
  }
  return "general"
}

function areAdjacent(a: string, b: string): boolean {
  return ADJACENT.has(`${a}:${b}`) || ADJACENT.has(`${b}:${a}`)
}

// Canonical key: smaller id first so A↔B === B↔A
function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`
}

function richness(c: Contact): number {
  return [c.title, c.company, c.tags, c.profile].filter(Boolean).length
}

type Candidate = { a: Contact; b: Contact; shared: string }

export async function generateIntroductionSuggestions(
  contacts: Contact[],
  respondedPairs: Set<string>
): Promise<IntroductionCandidate[]> {
  if (contacts.length < 2) return []

  const bucketed = contacts.map((c) => ({ contact: c, bucket: assignBucket(c) }))
  const candidates: Candidate[] = []
  const seen = new Set<string>()

  for (let i = 0; i < bucketed.length; i++) {
    for (let j = i + 1; j < bucketed.length; j++) {
      const a = bucketed[i]
      const b = bucketed[j]
      const key = pairKey(a.contact.id, b.contact.id)
      if (seen.has(key) || respondedPairs.has(key)) continue
      if (a.bucket === b.bucket || areAdjacent(a.bucket, b.bucket)) {
        seen.add(key)
        candidates.push({
          a: a.contact,
          b: b.contact,
          shared: a.bucket === b.bucket ? a.bucket : `${a.bucket}/${b.bucket}`,
        })
      }
    }
  }

  if (candidates.length === 0) return []

  // Prefer richer contacts — more data = better suggestions; cap at 30 for token budget
  const top = candidates
    .sort((x, y) => richness(y.a) + richness(y.b) - (richness(x.a) + richness(x.b)))
    .slice(0, 30)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return buildFallback(top)

  return callClaude(top, apiKey)
}

function formatSummary(c: Contact): string {
  return [
    `Name: ${c.name}`,
    c.title ? `Title: ${c.title}` : null,
    c.company ? `Company: ${c.company}` : null,
    c.tags ? `Tags: ${c.tags}` : null,
    c.profile ? `Profile: ${c.profile.slice(0, 200)}` : null,
  ]
    .filter(Boolean)
    .join(", ")
}

async function callClaude(candidates: Candidate[], apiKey: string): Promise<IntroductionCandidate[]> {
  const pairList = candidates
    .map(
      (c, i) =>
        `${i + 1}. [domain: ${c.shared}]\n   A: ${formatSummary(c.a)}\n   B: ${formatSummary(c.b)}`
    )
    .join("\n\n")

  const userMessage = `Here are candidate pairs from a personal professional network. Analyze each and decide which would genuinely benefit from an introduction.

${pairList}

Return raw JSON only (no markdown fences):
{
  "suggestions": [
    {
      "pairIndex": <1-based integer>,
      "score": <0.0-10.0>,
      "rationale": "<1-2 sentences explaining the specific value of connecting them>"
    }
  ]
}

Rules:
- Only include pairs with score >= 6.0
- Be selective — 3-5 strong matches beats 10 weak ones
- Rationale must be specific to these two people, not generic
- Order by score descending`

  try {
    const client = new Anthropic({ apiKey })
    const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001"

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system:
        "You are a professional networking analyst. Identify genuinely valuable introduction opportunities between people in someone's network. Focus on complementary skills, shared professional interests, or mutual benefit. Return only valid JSON.",
      messages: [{ role: "user", content: userMessage }],
    })

    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : ""
    // Strip markdown code fences if the model wraps the JSON
    const jsonText = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    const parsed = JSON.parse(jsonText) as {
      suggestions: Array<{ pairIndex: number; score: number; rationale: string }>
    }

    return parsed.suggestions
      .filter((s) => s.pairIndex >= 1 && s.pairIndex <= candidates.length && s.score >= 6)
      .map((s) => {
        const c = candidates[s.pairIndex - 1]
        const [idA, idB] = c.a.id < c.b.id ? [c.a.id, c.b.id] : [c.b.id, c.a.id]
        return { contactAId: idA, contactBId: idB, rationale: s.rationale, score: s.score }
      })
  } catch (err) {
    console.error("Claude introduction analysis failed, using fallback:", err)
    return buildFallback(candidates)
  }
}

function buildFallback(candidates: Candidate[]): IntroductionCandidate[] {
  return candidates.slice(0, 5).map((c) => {
    const [idA, idB] = c.a.id < c.b.id ? [c.a.id, c.b.id] : [c.b.id, c.a.id]
    return {
      contactAId: idA,
      contactBId: idB,
      rationale: `Both work in ${c.shared} — connecting them could open up new opportunities or collaborations.`,
      score: 6.0,
    }
  })
}
