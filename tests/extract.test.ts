import { describe, it, expect } from "vitest";
import { buildFallback, normalize } from "@/lib/extract";

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
