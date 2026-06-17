import OpenAI from "openai";
import type { ContactInput } from "@/lib/types";

export type ExtractResult = {
  fields: ContactInput;
  model: string;
};

function buildSystemPrompt(): string {
  const currentYear = new Date().getFullYear();
  return `You extract structured contact details from freeform text
(typed notes or a transcribed voice message) for a relationship-management app.
Current year: ${currentYear}.

Return ONLY a JSON object with these keys:

STANDARD FIELDS — use "" for any you cannot determine:
- name: full name (normalize to proper case)
- title: job title or role
- company: organization they work for
- email: email address (repair speech-to-text: "at" → "@", "dot"/"period" → ".")
- phone: phone number (digits + optional leading "+"; strip spaces/hyphens from dictation)
- location: city, region, or country
- tags: comma-separated short professional keywords (e.g. "investor, fintech, warm-lead")
- howWeMet: where or how the connection was made

DYNAMIC FIELDS — add a "customFields" key for ALL notable personal details found in the story.
Be thorough — the more context captured, the better. Categories to look for:

BIOGRAPHICAL
- "Age": their age if stated (e.g. "25")
- "Birth Year": calculate from age + current year if age is known (e.g. age 25 in ${currentYear} → "${currentYear - 25}")

ACADEMIC / RESEARCH
- "Research": any research topic, theory, or hypothesis they are investigating
- "Thesis": specific thesis or academic argument they hold
- "Studies": field of formal study
- "Education": school, degree, or certification

PROFESSIONAL
- "Skills": specific technical or professional skills
- "Specialization": niche domain they are expert in (e.g. "Robotics in Healthcare")
- "Industries": industries they operate in or are interested in

PERSONAL
- "Interests": hobbies and personal interests (comma-separated)
- "Hobbies": recreational activities
- "Languages": languages they speak
- "Personality": notable personality traits mentioned

RELATIONSHIP
- "Relationship": how the contact relates to the narrator (e.g. "junior by 3 years", "mentor", "peer")
- "Mutual Connection": shared acquaintances or context

RULES:
- Include both explicitly stated AND directly inferable facts (e.g. age + current year → birth year)
- Use clean, short label names (capitalize first letter)
- Omit "customFields" entirely if nothing extra is mentioned

Example output:
{
  "name": "Cirilo Siri",
  "title": "AI Automation Engineer",
  "company": "Innovation Hub Digital Marketing Services",
  "location": "Metro Manila",
  "tags": "AI, automation, robotics, healthcare",
  "howWeMet": "Hong Kong AI Data Center introduction event",
  "customFields": {
    "Age": "25",
    "Birth Year": "${currentYear - 25}",
    "Interests": "Robotics, Programming, Quantum Mechanics, Time Travel Theory",
    "Research": "Time travel physics — surpassing the speed of light and traveling at hundreds of light years",
    "Specialization": "Robotics in Healthcare",
    "Relationship": "Junior colleague, 3 years younger than narrator"
  }
}

Output valid JSON only — no markdown fences, no commentary.`;
}

const FIELD_KEYS: (keyof Omit<ContactInput, "customFields">)[] = [
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

function normalize(raw: unknown): ContactInput {
  const out = emptyFields();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;

  for (const key of FIELD_KEYS) {
    const v = obj[key];
    if (typeof v === "string") out[key] = v.trim();
    else if (Array.isArray(v)) out[key] = v.map(String).join(", ").trim();
  }

  // Extract dynamic custom fields
  if (
    obj.customFields &&
    typeof obj.customFields === "object" &&
    !Array.isArray(obj.customFields)
  ) {
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      obj.customFields as Record<string, unknown>
    )) {
      if (typeof v === "string" && v.trim()) {
        custom[k] = v.trim();
      } else if (Array.isArray(v)) {
        const joined = v
          .map(String)
          .filter(Boolean)
          .join(", ");
        if (joined) custom[k] = joined;
      }
    }
    if (Object.keys(custom).length > 0) out.customFields = custom;
  }

  return out;
}

// Deterministic fallback — extracts as many fields as possible without an API key.
function buildFallback(text: string): ContactInput {
  const fields = emptyFields();

  // Email
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) fields.email = emailMatch[0];

  // Phone
  const phoneMatch = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phoneMatch) fields.phone = phoneMatch[0].trim();

  // Name: capitalized words first (properly typed text)
  const capsMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/);
  if (capsMatch) {
    fields.name = capsMatch[1];
  } else {
    // Lowercase speech-to-text: "I met/meet [first last]"
    const metMatch = text.match(
      /\bi\s+(?:met|meet|know|knew|introduced\s+to)\s+([a-z]+(?:\s+[a-z]+)?)/i
    );
    if (metMatch) {
      fields.name = metMatch[1]
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  // Title: "he/she is a/an [title] at"
  const titleMatch = text.match(
    /\b(?:he|she)\s+is\s+(?:a|an)\s+([\w\s]+?)\s+at\s+/i
  );
  if (titleMatch) fields.title = titleMatch[1].trim();

  // Company: "is a/an [title] at [Company] base/based/,/."
  const companyMatch = text.match(
    /\bis\s+(?:a|an)\s+[\w\s]+?\s+at\s+([A-Za-z][\w\s]+?)\s+(?:base|based|,|\.)/i
  );
  if (companyMatch) fields.company = companyMatch[1].trim();

  // Location: "base/based on/in/at [City]"
  const locationMatch = text.match(
    /\bbas(?:e|ed)\s+(?:on|in|at)\s+([A-Za-z][\w\s,]+?)(?:[,.]|$)/i
  );
  if (locationMatch) fields.location = locationMatch[1].trim();

  // How we met: "I meet/met [Name] at [place] for …" — capture from "at" to end of sentence
  const howWeMetMatch = text.match(
    /\bi\s+(?:meet|met|saw|run\s+into)\s+[\w\s]+?\s+at\s+([^.]+)/i
  );
  if (howWeMetMatch) fields.howWeMet = howWeMetMatch[1].trim();

  const custom: Record<string, string> = {};

  // Interests
  const interestMatch = text.match(/\binterest(?:s|ed)?\s+in\s+([^.]+)/i);
  if (interestMatch) custom["Interests"] = interestMatch[1].trim();

  // Age — "he/she is X years old" or "currently X years old"
  const ageMatch = text.match(/\b(?:is\s+)?(?:currently\s+)?(\d{1,3})\s+years?\s+old/i);
  if (ageMatch) {
    const age = ageMatch[1];
    custom["Age"] = age;
    custom["Birth Year"] = String(new Date().getFullYear() - parseInt(age, 10));
  }

  // Research / thesis — "research about" or "theory about"
  const researchMatch = text.match(
    /\b(?:research(?:ing)?|thesis|theory|studying|investigat(?:es?|ing))\s+(?:about|on|into)?\s+([^.]+)/i
  );
  if (researchMatch) custom["Research"] = researchMatch[1].trim();

  // Specialization — domain + industry pairing (e.g. "robotics in health care")
  const specMatch = text.match(
    /\b(robotics|AI|automation|machine\s+learning|data\s+science)\s+in\s+([\w\s]+?)(?:[.,]|$)/i
  );
  if (specMatch) custom["Specialization"] = `${specMatch[1]} in ${specMatch[2].trim()}`;

  // Relationship — "junior" / "senior" / "older/younger than me"
  const relMatch = text.match(
    /\b(?:(?:my\s+)?junior|senior|older\s+than\s+(?:me|him|her)|younger\s+than\s+(?:me|him|her))\b[^.]*/i
  );
  if (relMatch) custom["Relationship"] = relMatch[0].trim();

  if (Object.keys(custom).length > 0) fields.customFields = custom;

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
        { role: "system", content: buildSystemPrompt() },
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
