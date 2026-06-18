import { describe, it, expect } from "vitest";
import type { Contact } from "@/lib/types";
import {
  normalizeBirthday,
  formatBirthday,
  parseStoredBirthday,
  liftBirthdayFromCustomFields,
  computeUpcomingBirthdays,
} from "@/lib/birthdays";

// Minimal Contact factory — only the fields the birthday code reads matter.
function mk(partial: Partial<Contact>): Contact {
  return {
    id: "c1",
    name: "Test",
    birthday: null,
    customFields: null,
    ...partial,
  } as Contact;
}

describe("normalizeBirthday", () => {
  it("normalizes month-name input without a year to --MM-DD", () => {
    expect(normalizeBirthday("May 14")).toBe("--05-14");
    expect(normalizeBirthday("14 May")).toBe("--05-14");
  });

  it("keeps the year when one is present", () => {
    expect(normalizeBirthday("May 14, 1990")).toBe("1990-05-14");
    expect(normalizeBirthday("1990-05-14")).toBe("1990-05-14");
    expect(normalizeBirthday("05/14/1990")).toBe("1990-05-14");
  });

  it("round-trips an already-canonical value", () => {
    expect(normalizeBirthday("--05-14")).toBe("--05-14");
    expect(normalizeBirthday("1990-05-14")).toBe("1990-05-14");
  });

  it("returns null when no month + day can be parsed", () => {
    expect(normalizeBirthday("sometime in spring")).toBeNull();
    expect(normalizeBirthday("March")).toBeNull(); // month only, no day
    expect(normalizeBirthday("")).toBeNull();
  });
});

describe("formatBirthday", () => {
  it("renders friendly strings", () => {
    expect(formatBirthday("--05-14")).toBe("May 14");
    expect(formatBirthday("1990-05-14")).toBe("May 14, 1990");
  });

  it("returns empty string for nullish input", () => {
    expect(formatBirthday(null)).toBe("");
    expect(formatBirthday(undefined)).toBe("");
  });
});

describe("parseStoredBirthday", () => {
  it("parses both canonical forms", () => {
    expect(parseStoredBirthday("--05-14")).toEqual({ year: null, month: 4, day: 14 });
    expect(parseStoredBirthday("1990-05-14")).toEqual({ year: 1990, month: 4, day: 14 });
  });
});

describe("liftBirthdayFromCustomFields", () => {
  it("pulls a birthday-like field out of customFields", () => {
    const res = liftBirthdayFromCustomFields({ Born: "May 14, 1984", Interests: "x" });
    expect(res.birthday).toBe("1984-05-14");
    expect(res.customFields).toEqual({ Interests: "x" });
  });

  it("does not treat Birth Year as a birthday", () => {
    const res = liftBirthdayFromCustomFields({ "Birth Year": "1990" });
    expect(res.birthday).toBeNull();
    expect(res.customFields).toEqual({ "Birth Year": "1990" });
  });

  it("handles null", () => {
    expect(liftBirthdayFromCustomFields(null)).toEqual({ birthday: null, customFields: null });
  });
});

describe("computeUpcomingBirthdays", () => {
  const now = new Date(2026, 5, 18); // June 18, 2026

  it("buckets today and tomorrow by daysUntil", () => {
    const res = computeUpcomingBirthdays(
      [
        mk({ id: "today", birthday: "--06-18" }),
        mk({ id: "tomorrow", birthday: "--06-19" }),
      ],
      60,
      now
    );
    expect(res.map((b) => [b.contact.id, b.daysUntil])).toEqual([
      ["today", 0],
      ["tomorrow", 1],
    ]);
  });

  it("computes the age the contact is turning when a year is known", () => {
    const res = computeUpcomingBirthdays([mk({ birthday: "1990-06-18" })], 60, now);
    expect(res[0].turningAge).toBe(36);
  });

  it("excludes birthdays beyond the window", () => {
    const res = computeUpcomingBirthdays([mk({ birthday: "--09-01" })], 60, now);
    expect(res).toHaveLength(0);
  });

  it("falls back to a birthday captured in customFields", () => {
    const res = computeUpcomingBirthdays(
      [mk({ birthday: null, customFields: { Birthday: "June 20" } })],
      60,
      now
    );
    expect(res).toHaveLength(1);
    expect(res[0].daysUntil).toBe(2);
  });
});
