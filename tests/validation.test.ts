import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  validateContact,
  validateCustomFields,
  validateNoteContent,
  LIMITS,
} from "@/lib/validation";

describe("isValidEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmail("jose@example.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.domain.co")).toBe(true);
  });
  it("rejects malformed addresses", () => {
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a @b.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("validateContact (full)", () => {
  it("requires a non-empty name", () => {
    expect(validateContact({}).ok).toBe(false);
    expect(validateContact({ name: "   " }).ok).toBe(false);
  });

  it("trims and returns clean fields", () => {
    const res = validateContact({ name: "  Sarah Chen  ", company: " Acme " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.name).toBe("Sarah Chen");
      expect(res.data.company).toBe("Acme");
      expect(res.data.email).toBeNull();
    }
  });

  it("rejects an invalid email", () => {
    const res = validateContact({ name: "X", email: "not-an-email" });
    expect(res.ok).toBe(false);
  });

  it("rejects an over-long name", () => {
    const res = validateContact({ name: "a".repeat(LIMITS.name + 1) });
    expect(res.ok).toBe(false);
  });

  it("normalizes empty optional strings to null", () => {
    const res = validateContact({ name: "X", phone: "   ", tags: "" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.phone).toBeNull();
      expect(res.data.tags).toBeNull();
    }
  });

  it("normalizes a freeform birthday to canonical form", () => {
    const res = validateContact({ name: "X", birthday: "May 14, 1990" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.birthday).toBe("1990-05-14");
  });

  it("stores a year-unknown birthday as --MM-DD", () => {
    const res = validateContact({ name: "X", birthday: "May 14" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.birthday).toBe("--05-14");
  });

  it("rejects an unparseable birthday", () => {
    const res = validateContact({ name: "X", birthday: "whenever" });
    expect(res.ok).toBe(false);
  });

  it("treats an empty birthday as null", () => {
    const res = validateContact({ name: "X", birthday: "  " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.birthday).toBeNull();
  });
});

describe("validateContact (partial / PATCH)", () => {
  it("does not require name when partial", () => {
    const res = validateContact({ company: "Acme" }, { partial: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.name).toBeUndefined();
      expect(res.data.company).toBe("Acme");
    }
  });

  it("rejects an explicitly emptied name", () => {
    const res = validateContact({ name: "" }, { partial: true });
    expect(res.ok).toBe(false);
  });

  it("only returns the keys present in the body", () => {
    const res = validateContact({ title: "VP" }, { partial: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Object.keys(res.data)).toEqual(["title"]);
    }
  });
});

describe("validateCustomFields", () => {
  it("treats null/empty as null", () => {
    expect(validateCustomFields(null)).toEqual({ ok: true, data: null });
    expect(validateCustomFields({})).toEqual({ ok: true, data: null });
  });

  it("drops blank keys/values and trims", () => {
    const res = validateCustomFields({ Interests: " hiking ", "": "x", Empty: "  " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ Interests: "hiking" });
  });

  it("rejects arrays", () => {
    expect(validateCustomFields(["a"]).ok).toBe(false);
  });

  it("rejects too many fields", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < LIMITS.customFieldCount + 1; i++) big[`k${i}`] = "v";
    expect(validateCustomFields(big).ok).toBe(false);
  });
});

describe("validateNoteContent", () => {
  it("requires non-empty content", () => {
    expect(validateNoteContent("").ok).toBe(false);
    expect(validateNoteContent("   ").ok).toBe(false);
    expect(validateNoteContent(undefined).ok).toBe(false);
  });
  it("trims and accepts valid content", () => {
    const res = validateNoteContent("  met at SaaStr  ");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe("met at SaaStr");
  });
  it("rejects content past the cap", () => {
    expect(validateNoteContent("a".repeat(LIMITS.noteContent + 1)).ok).toBe(false);
  });
});
