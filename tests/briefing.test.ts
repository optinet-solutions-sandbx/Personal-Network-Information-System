import { describe, it, expect } from "vitest";
import { buildFallback, buildUserMessage } from "@/lib/briefing";

const BASE = {
  name: "Alice Nguyen",
  notes: [] as { content: string; createdAt: string }[],
};

describe("buildFallback", () => {
  it("always includes Who They Are and Suggested Talking Points", () => {
    const result = buildFallback(BASE);
    expect(result).toContain("### Who They Are");
    expect(result).toContain("### Suggested Talking Points");
  });

  it("includes the contact name in the Who They Are section", () => {
    const result = buildFallback(BASE);
    expect(result).toContain("Alice Nguyen");
  });

  it("includes Recent Notes section when notes are present", () => {
    const result = buildFallback({
      ...BASE,
      notes: [{ content: "Discussed the Q3 roadmap.", createdAt: "2026-06-01T10:00:00Z" }],
    });
    expect(result).toContain("### Recent Notes");
    expect(result).toContain("Discussed the Q3 roadmap.");
  });

  it("omits Recent Notes section when there are no notes", () => {
    const result = buildFallback(BASE);
    expect(result).not.toContain("### Recent Notes");
  });

  it("mentions the company in talking points when company is set", () => {
    const result = buildFallback({ ...BASE, company: "Acme Corp" });
    expect(result).toContain("Acme Corp");
  });

  it("includes Key Facts when howWeMet is set", () => {
    const result = buildFallback({ ...BASE, howWeMet: "Conference in 2024" });
    expect(result).toContain("### Key Facts");
    expect(result).toContain("Conference in 2024");
  });

  it("omits Key Facts section when no fact fields are filled", () => {
    const result = buildFallback(BASE);
    expect(result).not.toContain("### Key Facts");
  });

  it("appends the fallback disclaimer", () => {
    const result = buildFallback(BASE);
    expect(result).toContain("OPENAI_API_KEY");
  });
});

describe("buildUserMessage", () => {
  it("includes non-null contact fields", () => {
    const result = buildUserMessage({
      ...BASE,
      title: "VP of Engineering",
      company: "Acme Corp",
    });
    expect(result).toContain("VP of Engineering");
    expect(result).toContain("Acme Corp");
  });

  it("omits null fields", () => {
    const result = buildUserMessage({ ...BASE, email: null, phone: null });
    expect(result).not.toContain("Email:");
    expect(result).not.toContain("Phone:");
  });

  it("formats notes with a date prefix", () => {
    const result = buildUserMessage({
      ...BASE,
      notes: [{ content: "Great call.", createdAt: "2026-06-10T09:00:00Z" }],
    });
    expect(result).toContain("Note 1 (");
    expect(result).toContain("Great call.");
  });

  it("uses '(no notes yet)' when notes array is empty", () => {
    const result = buildUserMessage(BASE);
    expect(result).toContain("(no notes yet)");
  });

  it("includes custom fields when present", () => {
    const result = buildUserMessage({
      ...BASE,
      customFields: { Hobbies: "Cycling", Industry: "Fintech" },
    });
    expect(result).toContain("Hobbies: Cycling");
    expect(result).toContain("Industry: Fintech");
  });

  it("appends existing profile when present", () => {
    const result = buildUserMessage({
      ...BASE,
      profile: "### Summary\nSenior leader at Acme.",
    });
    expect(result).toContain("Senior leader at Acme.");
  });
});
