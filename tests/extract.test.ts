import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the OpenAI SDK so extractContact's network paths are deterministic.
// vi.hoisted lets the mock factory (which is hoisted above imports) reference
// these spies.
const { chatCreate, responsesCreate } = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  responsesCreate: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: chatCreate } };
    responses = { create: responsesCreate };
  },
}));

import {
  buildFallback,
  normalize,
  parseLooseJson,
  extractContact,
} from "@/lib/extract";

// ---------------------------------------------------------------------------
// buildFallback — the keyless, deterministic regex extractor used when no
// OPENAI_API_KEY is set. It only knows the story text (no STT repair, no
// enrichment), so these tests pin the regex behavior exactly.
// ---------------------------------------------------------------------------
describe("buildFallback", () => {
  it("pulls an email address out of the text", () => {
    expect(buildFallback("Reach her at sarah.chen@acme.io anytime.").email).toBe(
      "sarah.chen@acme.io"
    );
  });

  it("does NOT repair spoken email syntax (that is the model's job)", () => {
    // "at"/"dot" repair only happens in the LLM prompt, never the fallback.
    expect(buildFallback("email her at sarah at acme dot io").email).toBe("");
  });

  it("pulls a phone number, preserving formatting", () => {
    expect(buildFallback("Call +1 (555) 123-4567 tomorrow.").phone).toBe(
      "+1 (555) 123-4567"
    );
  });

  it("extracts a capitalized name from typed text", () => {
    expect(buildFallback("Sarah Chen joined last week.").name).toBe("Sarah Chen");
  });

  it("recovers a lowercase name from speech-to-text and title-cases it", () => {
    expect(buildFallback("i met john smith at a meetup").name).toBe("John Smith");
  });

  it("extracts title, company, and location together", () => {
    const f = buildFallback(
      "She is a software engineer at Acme Corp based in Boston."
    );
    expect(f.title).toBe("software engineer");
    expect(f.company).toBe("Acme Corp");
    expect(f.location).toBe("Boston");
  });

  it("captures how-we-met from an 'I met … at …' phrasing", () => {
    expect(
      buildFallback("I met Dana at the fintech summit last spring.").howWeMet
    ).toBe("the fintech summit last spring");
  });

  it("captures interests into customFields", () => {
    expect(buildFallback("He is interested in robotics and AI.").customFields).toEqual(
      { Interests: "robotics and AI" }
    );
  });

  it("derives Birth Year from a stated age", () => {
    const year = new Date().getFullYear();
    expect(buildFallback("He is 30 years old.").customFields).toEqual({
      Age: "30",
      "Birth Year": String(year - 30),
    });
  });

  it("parses an explicit birthday with no year to --MM-DD", () => {
    expect(buildFallback("Her birthday is March 15.").birthday).toBe("--03-15");
  });

  it("parses an explicit birthday with a year to YYYY-MM-DD", () => {
    expect(buildFallback("He was born on July 4, 1990.").birthday).toBe("1990-07-04");
  });

  it("captures a research topic", () => {
    expect(
      buildFallback("She is researching about quantum computing.").customFields
    ).toEqual({ Research: "quantum computing" });
  });

  it("captures a specialization (domain in industry)", () => {
    expect(
      buildFallback("He works on robotics in healthcare.").customFields
    ).toEqual({ Specialization: "robotics in healthcare" });
  });

  it("captures the relationship to the narrator", () => {
    expect(
      buildFallback("He is my junior by two years.").customFields
    ).toEqual({ Relationship: "my junior by two years" });
  });

  it("returns empty fields and no customFields when nothing matches", () => {
    const f = buildFallback("");
    expect(f.name).toBe("");
    expect(f.email).toBe("");
    expect(f.phone).toBe("");
    expect(f.customFields).toBeUndefined();
  });

  it("handles a full freeform story end to end", () => {
    const f = buildFallback(
      "I met Sarah Chen at a fintech conference. She is a product manager " +
        "at Stripe based in San Francisco. Reach her at sarah@stripe.com " +
        "or +1 (415) 555-0199."
    );
    expect(f.name).toBe("Sarah Chen");
    expect(f.title).toBe("product manager");
    expect(f.company).toBe("Stripe");
    expect(f.location).toBe("San Francisco");
    expect(f.email).toBe("sarah@stripe.com");
    expect(f.phone).toBe("+1 (415) 555-0199");
    expect(f.howWeMet).toBe("a fintech conference");
  });
});

// ---------------------------------------------------------------------------
// normalize — the guard that cleans raw model JSON: coerces/trims standard
// fields, sanitizes customFields, and merges enrichment under strict rules
// (story facts win, contact-detail keys are never enriched).
// ---------------------------------------------------------------------------
describe("normalize", () => {
  it("returns empty fields for non-object input", () => {
    for (const bad of [null, undefined, "json", 42]) {
      const { fields, enriched } = normalize(bad);
      expect(fields.name).toBe("");
      expect(fields.customFields).toBeUndefined();
      expect(enriched).toEqual([]);
    }
  });

  it("trims string fields and ignores unknown keys", () => {
    const { fields } = normalize({
      name: "  Sarah Chen  ",
      title: " Engineer ",
      bogus: "ignored",
    });
    expect(fields.name).toBe("Sarah Chen");
    expect(fields.title).toBe("Engineer");
    expect((fields as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("flattens an array-valued standard field into a comma string", () => {
    const { fields } = normalize({ tags: ["fintech", "investor"] });
    expect(fields.tags).toBe("fintech, investor");
  });

  it("sanitizes customFields: trims, drops blanks, joins arrays", () => {
    const { fields } = normalize({
      customFields: { Interests: " hiking ", Empty: "   ", Langs: ["en", "es"] },
    });
    expect(fields.customFields).toEqual({
      Interests: "hiking",
      Langs: "en, es",
    });
  });

  it("omits customFields entirely when there are none", () => {
    const { fields } = normalize({ name: "X" });
    expect(fields.customFields).toBeUndefined();
  });

  it("merges enrichment but lets story facts win on key collisions", () => {
    const { fields, enriched } = normalize({
      name: "X",
      customFields: { Specialization: "Robotics" },
      enrichment: { Occupation: "CEO", Specialization: "should not override" },
    });
    expect(fields.customFields).toEqual({
      Specialization: "Robotics",
      Occupation: "CEO",
    });
    expect(enriched).toEqual(["Occupation"]);
  });

  it("never enriches contact-detail keys (email/phone/mobile/etc.)", () => {
    const { fields, enriched } = normalize({
      name: "X",
      enrichment: {
        Occupation: "Engineer",
        "Personal Email": "x@y.com",
        Mobile: "+15551234567",
      },
    });
    expect(fields.customFields).toEqual({ Occupation: "Engineer" });
    expect(enriched).toEqual(["Occupation"]);
  });
});

// ---------------------------------------------------------------------------
// parseLooseJson — pulls a JSON object out of model output that may be wrapped
// in ```json fences or surrounded by prose. Throws only when the braces it
// finds enclose invalid JSON (callers run it inside try/catch).
// ---------------------------------------------------------------------------
describe("parseLooseJson", () => {
  it("parses plain JSON", () => {
    expect(parseLooseJson('{"name":"Sarah"}')).toEqual({ name: "Sarah" });
  });

  it("strips ```json fences", () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips bare ``` fences", () => {
    expect(parseLooseJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("extracts the object from surrounding prose", () => {
    expect(parseLooseJson('Here you go: {"a":1} — hope that helps')).toEqual({
      a: 1,
    });
  });

  it("returns null when there is no JSON object", () => {
    expect(parseLooseJson("no json here")).toBeNull();
    expect(parseLooseJson("")).toBeNull();
  });

  it("throws when the braces enclose malformed JSON", () => {
    expect(() => parseLooseJson("{ not valid }")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractContact — orchestration. The OpenAI SDK is mocked, so these tests
// pin the three-tier behavior: keyless fallback, story extraction, and the
// web/knowledge enrichment merge. Network failures degrade gracefully.
// ---------------------------------------------------------------------------
describe("extractContact", () => {
  // .env is not loaded under vitest, so these are usually undefined — capture
  // and restore exactly to avoid leaking state into other tests.
  const ORIGINAL = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    search: process.env.OPENAI_SEARCH_MODEL,
  };

  function setOrDelete(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default the model env vars so the model label is predictable.
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_SEARCH_MODEL;
  });

  afterEach(() => {
    setOrDelete("OPENAI_API_KEY", ORIGINAL.key);
    setOrDelete("OPENAI_MODEL", ORIGINAL.model);
    setOrDelete("OPENAI_SEARCH_MODEL", ORIGINAL.search);
  });

  it("uses the deterministic fallback when no API key is set", async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await extractContact("Reach her at sarah@acme.io");
    expect(res.model).toBe("fallback");
    expect(res.fields.email).toBe("sarah@acme.io");
    expect(res.enriched).toEqual([]);
    expect(res.enrichedContact).toEqual([]);
    expect(res.sources).toEqual([]);
    expect(chatCreate).not.toHaveBeenCalled();
  });

  it("falls back when the story-extraction call throws", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    chatCreate.mockRejectedValue(new Error("rate limited"));
    const res = await extractContact("Reach her at sarah@acme.io");
    expect(chatCreate).toHaveBeenCalledTimes(1);
    expect(res.model).toBe("fallback");
    expect(res.fields.email).toBe("sarah@acme.io");
  });

  it("falls back when the model returns malformed JSON", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    chatCreate.mockResolvedValue({
      choices: [{ message: { content: "{ not valid json }" } }],
      model: "gpt-4o-mini",
    });
    const res = await extractContact("Reach her at sarah@acme.io");
    expect(res.model).toBe("fallback");
    expect(res.fields.email).toBe("sarah@acme.io");
  });

  it("falls back on an empty completion", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    chatCreate.mockResolvedValue({
      choices: [{ message: { content: "   " } }],
      model: "gpt-4o-mini",
    });
    const res = await extractContact("Reach her at sarah@acme.io");
    expect(res.model).toBe("fallback");
  });

  it("returns normalized story fields on a successful extraction", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    chatCreate.mockResolvedValue({
      choices: [
        { message: { content: '{"name":"  Sarah Chen ","title":"PM"}' } },
      ],
      model: "gpt-4o-mini",
    });
    const res = await extractContact("met sarah");
    expect(chatCreate).toHaveBeenCalledTimes(1);
    expect(responsesCreate).not.toHaveBeenCalled();
    expect(res.fields.name).toBe("Sarah Chen");
    expect(res.fields.title).toBe("PM");
    expect(res.model).toBe("gpt-4o-mini");
    expect(res.enriched).toEqual([]);
    expect(res.enrichedContact).toEqual([]);
    expect(res.sources).toEqual([]);
  });

  it("merges web enrichment facts and official contact email, story winning", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-4o-mini"; // pin the label independent of the default
    chatCreate.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ name: "Mark Z", company: "Meta" }) } },
      ],
      model: "gpt-4o-mini",
    });
    responsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        identified: true,
        email: "press@meta.com",
        phone: "",
        emailSource: "https://about.meta.com/contact/",
        phoneSource: "",
        fields: [
          { label: "Known For", value: "Co-founding Facebook" },
          { label: "Personal Email", value: "leak@gmail.com" }, // contact key → dropped
        ],
        sources: [
          { title: "Meta", url: "https://about.meta.com/contact/" },
          { title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Mark_Zuckerberg" },
        ],
      }),
    });
    const res = await extractContact("I met Mark Z at a conference", {
      enrich: true,
    });
    expect(res.fields.customFields).toEqual({ "Known For": "Co-founding Facebook" });
    expect(res.enriched).toEqual(["Known For"]);
    expect(res.fields.email).toBe("press@meta.com");
    expect(res.enrichedContact).toEqual(["email"]);
    // The web-sourced email carries the exact page URL it was found on.
    expect(res.enrichedContactSources).toEqual({
      email: "https://about.meta.com/contact/",
    });
    expect(res.model).toBe("gpt-4o-mini + web_search");
  });

  it("cites the top source for a web contact value when no per-field URL is given", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    chatCreate.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ name: "Mark Z", company: "Meta" }) } },
      ],
      model: "gpt-4o-mini",
    });
    responsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        identified: true,
        email: "",
        phone: "+1 650-543-4800",
        emailSource: "",
        phoneSource: "", // omitted → falls back to the top source
        fields: [],
        sources: [
          { title: "Meta", url: "https://about.meta.com/contact/" },
        ],
      }),
    });
    const res = await extractContact("I met Mark Z at a conference", {
      enrich: true,
    });
    expect(res.fields.phone).toBe("+1 650-543-4800");
    expect(res.enrichedContact).toEqual(["phone"]);
    expect(res.enrichedContactSources).toEqual({
      phone: "https://about.meta.com/contact/",
    });
  });

  it("falls back to knowledge-based enrichment when web search fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    chatCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ name: "Ada L" }) } }],
        model: "gpt-4o-mini",
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "Ada L",
                enrichment: { Occupation: "Mathematician" },
              }),
            },
          },
        ],
        model: "gpt-4o-mini",
      });
    responsesCreate.mockRejectedValue(new Error("web search down"));
    const res = await extractContact("I met Ada L", { enrich: true });
    expect(responsesCreate).toHaveBeenCalledTimes(1);
    expect(chatCreate).toHaveBeenCalledTimes(2);
    expect(res.fields.customFields).toEqual({ Occupation: "Mathematician" });
    expect(res.enriched).toEqual(["Occupation"]);
  });
});
