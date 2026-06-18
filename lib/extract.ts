import OpenAI from "openai";
import type { ContactInput } from "@/lib/types";

export type Source = { title: string; url: string };

export type ExtractResult = {
  fields: ContactInput;
  model: string;
  // customFields keys that did NOT come from the story — they were added by web
  // enrichment (or, as a fallback, the model's training knowledge). The UI
  // renders these separately and flags them for verification.
  enriched: string[];
  // Standard contact fields ("email"/"phone") that were filled from public web
  // sources rather than the story. The UI badges these for verification.
  enrichedContact: string[];
  // Per-field citation for the web-sourced contact details above: maps a field
  // key ("email"/"phone") to the exact page URL it was found on, so the UI can
  // render a clickable "verify" chip pointing straight at the source.
  enrichedContactSources: Record<string, string>;
  // Web pages the enrichment drew from (empty unless live web search ran).
  sources: Source[];
};

function buildSystemPrompt(enrich: boolean, hasImages = false): string {
  const currentYear = new Date().getFullYear();
  return `You extract structured contact details from freeform text
(typed notes or a transcribed voice message) for a relationship-management app.
Current year: ${currentYear}.
${
  hasImages
    ? `
The user has ALSO attached one or more photos (e.g. a business card, a conference
badge, an email signature, a profile screenshot, or a photo of an object/place tied
to this person). Read ALL text visible in the images and treat it as a primary source,
combining it with any typed notes. Map anything that fits a standard field above into
that field. Capture any OTHER readable text or notable visible detail — a product,
brand, book, poster, sign, logo, or handwriting — under "customFields" with a clear
label, so nothing legible in the photo is lost. Only transcribe what is actually
visible — never invent or guess text that is not there.
`
    : ""
}

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
- birthday: birth date as "--MM-DD" (no year) or "YYYY-MM-DD" (with year) — only set if explicitly stated; NEVER infer or fabricate from age alone

DYNAMIC FIELDS — add a "customFields" object capturing ALL notable personal details
stated in the story. Be thorough; use clean, short Capitalized labels. Common labels:
Research, Thesis, Studies, Education, Skills, Specialization, Industries, Interests,
Hobbies, Languages, Personality, Relationship, Mutual Connection — and any other clearly
stated detail.
- "Age": ONLY if an age is explicitly stated (e.g. "she is 25"). Never estimate.
- "Birth Year": ONLY when an explicit age/birth year is stated — compute from age + current
  year (age 25 in ${currentYear} → "${currentYear - 25}"). Do NOT infer it from graduation
  year, years of experience, or any other proxy. Otherwise OMIT both "Age" and "Birth Year".

RULES:
- Include only explicitly stated facts. The ONLY inference allowed is a stated age → birth year.
- Omit "customFields" entirely if nothing extra is mentioned.
${
  enrich
    ? `
ENRICHMENT (the user has enabled "enrich from public knowledge"):
Add a SEPARATE "enrichment" object with well-known PUBLIC facts about this person
that were NOT stated in the story — but ONLY if the named person is a widely
recognized PUBLIC FIGURE you have reliable, publicly-documented knowledge of.

Allowed enrichment keys (include only those you are confident are publicly documented):
- "Occupation": what they are publicly known for doing
- "Current Company": their primary current organization/role
- "Known For": primary public accomplishment
- "Born": publicly-known date of birth (public figures only)
- "Nationality"
- "Education"
- "Interests" / "Hobbies": publicly-reported interests
- "Notable Work": companies, products, or projects they are publicly associated with

STRICT SAFETY RULES FOR ENRICHMENT — follow exactly:
- NEVER fabricate or guess. If you are not confident a fact is publicly documented, OMIT that key.
- NEVER output a private email address or phone number under ANY key. Personal contact
  details are not public facts — always leave email/phone blank, even for public figures.
- For ordinary or private individuals you have no reliable public knowledge of,
  OMIT the "enrichment" object entirely. Do not invent a persona.
- Enrichment facts may be outdated; they are unverified hints for the user to confirm.
`
    : ""
}
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
  }${
    enrich
      ? `,
  "enrichment": {
    "Occupation": "Co-founder, Chairman & CEO of Meta Platforms",
    "Known For": "Co-founding Facebook",
    "Born": "May 14, 1984"
  }`
      : ""
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
  "birthday",
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
    birthday: "",
  };
}

// Coerce an arbitrary object of {label: value} into clean string entries.
function toStringMap(raw: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) map[k] = v.trim();
    else if (Array.isArray(v)) {
      const joined = v.map(String).filter(Boolean).join(", ");
      if (joined) map[k] = joined;
    }
  }
  return map;
}

// Safety net: a contact's private email/phone must never arrive via enrichment,
// regardless of what the model returns. Drop any such key defensively.
function isContactKey(key: string): boolean {
  return /\b(e-?mail|phone|mobile|cell|whatsapp|telephone)\b/i.test(key);
}

export function normalize(raw: unknown): { fields: ContactInput; enriched: string[] } {
  const out = emptyFields();
  if (!raw || typeof raw !== "object") return { fields: out, enriched: [] };
  const obj = raw as Record<string, unknown>;

  for (const key of FIELD_KEYS) {
    const v = obj[key];
    if (typeof v === "string") out[key] = v.trim();
    else if (Array.isArray(v)) out[key] = v.map(String).join(", ").trim();
  }

  const custom = toStringMap(obj.customFields);

  // Merge public-knowledge enrichment into customFields. Story-derived facts
  // always win on key collisions, and contact-detail keys are never enriched.
  const enriched: string[] = [];
  for (const [k, v] of Object.entries(toStringMap(obj.enrichment))) {
    if (isContactKey(k) || k in custom) continue;
    custom[k] = v;
    enriched.push(k);
  }

  if (Object.keys(custom).length > 0) out.customFields = custom;
  return { fields: out, enriched };
}

// Deterministic fallback — extracts as many fields as possible without an API key.
export function buildFallback(text: string): ContactInput {
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

  // Birthday — explicit month/day mentions like "birthday is March 15" or "born on July 4, 1990"
  const MONTHS: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07",
    aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const bdMatch = text.match(
    /\b(?:birthday|born|birth\s+date)\b[^.]*?\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?/i
  );
  if (bdMatch) {
    const mm = MONTHS[bdMatch[1].toLowerCase()];
    const dd = bdMatch[2].padStart(2, "0");
    const yyyy = bdMatch[3];
    fields.birthday = yyyy ? `${yyyy}-${mm}-${dd}` : `--${mm}-${dd}`;
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

// Strip ```json fences a model sometimes wraps JSON in, then parse.
export function parseLooseJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  return JSON.parse(cleaned.slice(start, end + 1));
}

const ENRICH_SYSTEM_PROMPT = `You are a research assistant for a relationship-management app.
Use web search to find PUBLICLY AVAILABLE information about the specific person described.
Use the provided context (company, location, how-we-met, role) to identify the RIGHT
individual — many people share a name.

"fields" is a list of { "label", "value" } facts. Use clear labels such as:
"Occupation", "Current Company", "Title", "Known For", "Location", "Education",
"Nationality", "Born", "Interests", "Hobbies", "Notable Work", "Public Profile", "Bio".

Do NOT return email addresses or phone numbers. Contact details are NEVER collected from
the web — models hallucinate plausible-but-wrong addresses and cite them to pages that do
not contain them. Leave contact info out of "fields" entirely, even for public figures;
email/phone come only from the user's own notes.

STRICT RULES — follow exactly:
- Set "identified" to false and return empty "fields" if you cannot confidently
  match a specific real person from the context. Do NOT guess or merge different people.
- Only include facts backed by a source you actually found. NEVER fabricate. When unsure, omit.
- PRIVACY: never return any email, phone, mobile, home address, or other private contact detail.
- Prefer authoritative sources (official site, company page, Wikipedia, LinkedIn, reputable press).
- Every value you return should be traceable to an entry in "sources".`;

// Strict JSON schema so web_search + Structured Outputs return parseable data.
// (Strict mode requires arrays of fixed-key objects, not free-form maps.)
const ENRICH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["identified", "fields", "sources"],
  properties: {
    identified: { type: "boolean" },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: { title: { type: "string" }, url: { type: "string" } },
      },
    },
  },
} as const;

// Live web enrichment via the Responses API + web_search tool. Returns public,
// cited facts about the person — or empty fields if no confident match.
async function enrichFromWeb(
  client: OpenAI,
  name: string,
  context: string,
  model: string
): Promise<{
  fields: Record<string, string>;
  sources: Source[];
}> {
  const response = await client.responses.create({
    model,
    tools: [{ type: "web_search" }],
    text: {
      format: {
        type: "json_schema",
        name: "enrichment",
        strict: true,
        schema: ENRICH_SCHEMA,
      },
    },
    input: [
      { role: "system", content: ENRICH_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Person to research: ${name}\n\nContext from the user's note:\n${context}`,
      },
    ],
  });

  const empty = { fields: {}, sources: [] };
  const parsed = parseLooseJson(response.output_text ?? "");
  if (!parsed || typeof parsed !== "object") return empty;
  const obj = parsed as Record<string, unknown>;
  if (obj.identified === false) return empty;

  // Custom facts only. Contact-detail keys are dropped defensively — we never
  // surface a web-sourced email/phone (the model fabricates them; see prompt).
  const fields: Record<string, string> = {};
  if (Array.isArray(obj.fields)) {
    for (const item of obj.fields) {
      if (!item || typeof item !== "object") continue;
      const label = String((item as Record<string, unknown>).label ?? "").trim();
      const value = String((item as Record<string, unknown>).value ?? "").trim();
      if (label && value && !isContactKey(label)) fields[label] = value;
    }
  }

  const sources: Source[] = [];
  if (Array.isArray(obj.sources)) {
    for (const s of obj.sources) {
      if (s && typeof s === "object") {
        const url = String((s as Record<string, unknown>).url ?? "").trim();
        const title = String((s as Record<string, unknown>).title ?? "").trim();
        if (/^https?:\/\//i.test(url)) sources.push({ url, title: title || url });
      }
    }
  }

  return { fields, sources };
}

export async function extractContact(
  text: string,
  opts: { enrich?: boolean; images?: string[] } = {}
): Promise<ExtractResult> {
  const input = text.trim();
  // Only accept image data URLs; anything else is dropped before hitting the model.
  const images = (opts.images ?? []).filter(
    (s) => typeof s === "string" && s.startsWith("data:image/")
  );
  const enrich = opts.enrich ?? false;
  const apiKey = process.env.OPENAI_API_KEY;

  // The deterministic fallback only knows the story text — it cannot read
  // images or enrich.
  if (!apiKey) {
    return {
      fields: buildFallback(input),
      model: "fallback",
      enriched: [],
      enrichedContact: [],
      enrichedContactSources: {},
      sources: [],
    };
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  // The story-extraction message is plain text unless photos were attached, in
  // which case we send a multimodal message so the vision model can OCR them.
  const userContent: OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"] =
    images.length > 0
      ? [
          {
            type: "text",
            text:
              input ||
              "Extract this person's contact details from the attached image(s).",
          },
          ...images.map(
            (url): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
              type: "image_url",
              image_url: { url },
            })
          ),
        ]
      : input;

  // 1) Extract what the STORY (and any photos) state — no enrichment here.
  let result: ExtractResult;
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(false, images.length > 0) },
        { role: "user", content: userContent },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) throw new Error("empty completion");
    const { fields } = normalize(parseLooseJson(raw));
    result = {
      fields,
      enriched: [],
      enrichedContact: [],
      enrichedContactSources: {},
      sources: [],
      model: completion.model || model,
    };
  } catch (err) {
    console.error("Story extraction failed, using fallback:", err);
    return {
      fields: buildFallback(input),
      model: "fallback",
      enriched: [],
      enrichedContact: [],
      enrichedContactSources: {},
      sources: [],
    };
  }

  if (!enrich || !result.fields.name?.trim()) return result;

  // 2) Enrich from the live web. Falls back to training knowledge on failure.
  const searchModel = process.env.OPENAI_SEARCH_MODEL || model;
  try {
    const { fields: webFields, sources } = await enrichFromWeb(
      client,
      result.fields.name,
      input,
      searchModel
    );
    mergeEnrichment(result, webFields);
    // NOTE: web enrichment deliberately never fills email/phone — the model
    // fabricates them. Contact fields come only from the user's own notes.

    result.sources = sources;
    if (result.enriched.length > 0) {
      result.model = `${searchModel} + web_search`;
    }
    return result;
  } catch (err) {
    console.error("Web enrichment failed, falling back to model knowledge:", err);
  }

  // 3) Knowledge-based fallback (no live data, no citations).
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(true) },
        { role: "user", content: input },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (raw) {
      const { fields, enriched } = normalize(parseLooseJson(raw));
      const knowledgeFields: Record<string, string> = {};
      for (const k of enriched) {
        const v = fields.customFields?.[k];
        if (v) knowledgeFields[k] = v;
      }
      mergeEnrichment(result, knowledgeFields);
    }
  } catch (err) {
    console.error("Knowledge enrichment fallback failed:", err);
  }
  return result;
}

// Merge enriched fields into a result's customFields: story facts always win,
// contact-detail keys are dropped, and merged keys are recorded as enriched.
function mergeEnrichment(result: ExtractResult, enriched: Record<string, string>) {
  const custom = { ...(result.fields.customFields ?? {}) };
  for (const [k, v] of Object.entries(enriched)) {
    if (isContactKey(k) || k in custom || !v.trim()) continue;
    custom[k] = v.trim();
    result.enriched.push(k);
  }
  if (Object.keys(custom).length > 0) result.fields.customFields = custom;
}
