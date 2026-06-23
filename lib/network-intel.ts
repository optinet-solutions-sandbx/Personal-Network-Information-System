// Network-level analytics ("business trend / network intelligence", Phase 3).
// Pure aggregation over the owner's contacts — no DB, no AI, trivially testable.
// The AI narrative lives in generateNetworkNarrative below (optional, like the
// other AI features).

import OpenAI from "openai";
import type { Contact } from "./types";

export type Tally = { label: string; count: number };

export type NetworkStats = {
  totalContacts: number;
  connections: number; // relationship edges (passed in)
  withBirthday: number;
  withNotes: number;
  topCompanies: Tally[];
  topLocations: Tally[];
  topTags: Tally[];
  topRoles: Tally[]; // functional buckets (engineering, sales, …)
  healthTiers: Tally[]; // Strong / Active / Fading / Dormant / Unknown
  growthByMonth: Tally[]; // new contacts per month, last 12 months (label = "YYYY-MM")
};

// Functional role buckets (kept local; mirrors the spirit of lib/introductions
// but tuned for distribution display).
const ROLE_BUCKETS: Record<string, string[]> = {
  Engineering: ["engineer", "developer", "software", "devops", "data", "cto", "programmer", "tech", "architect"],
  "Design": ["designer", "ux", "ui", "creative", "art director", "visual"],
  Marketing: ["marketing", "brand", "content", "seo", "growth", "communications", "pr"],
  Sales: ["sales", "account", "business development", "bdr", "sdr", "revenue", "partnerships"],
  Finance: ["finance", "accounting", "cfo", "investment", "banker", "analyst", "vc", "capital"],
  Legal: ["lawyer", "attorney", "legal", "counsel", "compliance"],
  Operations: ["operations", "ops", "logistics", "supply chain", "project manager", "program manager"],
  "People / HR": ["hr", "human resources", "recruiter", "talent", "people"],
  Product: ["product manager", "product owner", "product", "scrum"],
  Leadership: ["ceo", "founder", "co-founder", "president", "vp", "director", "head of", "owner", "chief"],
};

function bucketRole(c: Contact): string {
  const text = [c.title ?? "", c.tags ?? ""].join(" ").toLowerCase();
  for (const [role, kws] of Object.entries(ROLE_BUCKETS)) {
    if (kws.some((kw) => text.includes(kw))) return role;
  }
  return "Other";
}

function tallyTop(values: string[], limit = 6): Tally[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    const entry = counts.get(key) ?? { label: v, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

// Last 12 months including `now`, oldest first, each labelled "YYYY-MM".
function monthBuckets(now: Date): { key: string; count: number }[] {
  const out: { key: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ key, count: 0 });
  }
  return out;
}

export function computeNetworkStats(
  contacts: Contact[],
  connections = 0,
  now: Date = new Date()
): NetworkStats {
  const tiers = new Map<string, number>([
    ["Strong", 0],
    ["Active", 0],
    ["Fading", 0],
    ["Dormant", 0],
    ["Unknown", 0],
  ]);
  const months = monthBuckets(now);
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));

  let withBirthday = 0;
  let withNotes = 0;

  for (const c of contacts) {
    const tier = c.healthTier && tiers.has(c.healthTier) ? c.healthTier : "Unknown";
    tiers.set(tier, (tiers.get(tier) ?? 0) + 1);

    if (c.birthday) withBirthday++;
    if ((c._count?.notes ?? c.notes?.length ?? 0) > 0) withNotes++;

    if (c.createdAt) {
      const d = new Date(c.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const idx = monthIndex.get(key);
      if (idx != null) months[idx].count++;
    }
  }

  return {
    totalContacts: contacts.length,
    connections,
    withBirthday,
    withNotes,
    topCompanies: tallyTop(contacts.map((c) => c.company ?? "")),
    topLocations: tallyTop(contacts.map((c) => c.location ?? "")),
    topTags: tallyTop(
      contacts.flatMap((c) => (c.tags ?? "").split(",").map((t) => t.trim()))
    ),
    topRoles: tallyTop(contacts.map(bucketRole)),
    healthTiers: [...tiers.entries()]
      .filter(([, n]) => n > 0)
      .map(([label, count]) => ({ label, count })),
    growthByMonth: months.map((m) => ({ label: m.key, count: m.count })),
  };
}

export type NarrativeResult = { narrative: string; model: string };

function buildFallbackNarrative(s: NetworkStats): string {
  if (s.totalContacts === 0) {
    return "Your network is empty — add a few contacts to start seeing trends here.";
  }
  const parts: string[] = [];
  const topCo = s.topCompanies[0];
  const topLoc = s.topLocations[0];
  const topRole = s.topRoles.find((r) => r.label !== "Other") ?? s.topRoles[0];
  parts.push(`You're tracking ${s.totalContacts} contacts with ${s.connections} mapped connection${s.connections === 1 ? "" : "s"}.`);
  if (topRole) parts.push(`The biggest functional group is **${topRole.label}** (${topRole.count}).`);
  if (topCo) parts.push(`Most-represented company: **${topCo.label}** (${topCo.count}).`);
  if (topLoc) parts.push(`You're most concentrated in **${topLoc.label}**.`);
  const dormant = s.healthTiers.find((t) => t.label === "Dormant")?.count ?? 0;
  if (dormant > 0) parts.push(`${dormant} relationship${dormant === 1 ? " is" : "s are"} dormant — worth reconnecting.`);
  parts.push("_Add an OPENAI_API_KEY for a richer AI analysis._");
  return parts.join(" ");
}

export async function generateNetworkNarrative(
  stats: NetworkStats
): Promise<NarrativeResult> {
  if (stats.totalContacts === 0) {
    return { narrative: buildFallbackNarrative(stats), model: "none" };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { narrative: buildFallbackNarrative(stats), model: "fallback" };

  const fmt = (t: Tally[]) => t.map((x) => `${x.label} (${x.count})`).join(", ") || "none";
  const userMessage = `Analyze this professional network and write a short narrative (2 short paragraphs, GitHub-flavored markdown, no headings) covering: where the network is concentrated, notable strengths, and 1-2 specific gaps or opportunities (e.g. an under-represented function or location, or dormant relationships to revive). Be specific and actionable; do not invent data beyond what's given.

Total contacts: ${stats.totalContacts}
Mapped connections: ${stats.connections}
Top companies: ${fmt(stats.topCompanies)}
Top locations: ${fmt(stats.topLocations)}
Top functional roles: ${fmt(stats.topRoles)}
Top tags: ${fmt(stats.topTags)}
Relationship health: ${fmt(stats.healthTiers)}
Contacts with notes: ${stats.withNotes}; with birthdays: ${stats.withBirthday}`;

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You are a networking strategist. Given aggregate stats about someone's professional network, give a concise, specific, actionable read on its shape, strengths, and gaps. Plain markdown prose, no headings, no preamble.",
        },
        { role: "user", content: userMessage },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return { narrative: buildFallbackNarrative(stats), model: "fallback" };
    return { narrative: text, model: completion.model ?? model };
  } catch (err) {
    console.error("network narrative generation failed, using fallback:", err);
    return { narrative: buildFallbackNarrative(stats), model: "fallback" };
  }
}
