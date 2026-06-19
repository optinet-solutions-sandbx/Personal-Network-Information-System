// Birthday parsing + scheduling helpers.
//
// Birthdays aren't a structured field on a contact — they live in customFields
// as freeform text (keys like "Birthday", "Born", "Date of Birth"). This module
// parses month/day out of common formats and projects them onto a calendar so
// both the dashboard and the notification bell can share one implementation.

import type { Contact } from "@/lib/types";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Custom-field keys that hold a birthday. Deliberately excludes "Birth Year"
// (year only — no day to place on a calendar).
const BIRTHDAY_KEY_RE = /birth\s*day|birth\s*date|date of birth|\bdob\b|\bborn\b/;

export type ParsedDate = { month: number; day: number; year: number | null };

// Parse a freeform date string into month/day (+ optional year). We need at
// least a month + day to place it on a calendar.
export function parseDateValue(raw: string): ParsedDate | null {
  const s = raw.trim().toLowerCase();

  // "May 14, 1984" / "March 15" / "15 March"
  const monthName = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (monthName) {
    const month = MONTHS[monthName[1]];
    const year = s.match(/\b(\d{4})\b/);
    const days = [...s.matchAll(/\b(\d{1,2})\b/g)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => n >= 1 && n <= 31);
    if (!days.length) return null; // month-only (e.g. "Birthday in March") — can't place a day
    return { month, day: days[0], year: year ? parseInt(year[1], 10) : null };
  }

  // ISO "1984-05-14"
  const iso = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const month = +iso[2] - 1;
    const day = +iso[3];
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    return { year: +iso[1], month, day };
  }

  // Numeric, month-first (US): "5/14", "05/14/1984"
  const num = s.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/);
  if (num) {
    const month = +num[1] - 1;
    const day = +num[2];
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    let year: number | null = null;
    if (num[3]) {
      year = +num[3];
      if (year < 100) year += year < 50 ? 2000 : 1900;
    }
    return { month, day, year };
  }

  return null;
}

export function parseBirthday(
  customFields: Record<string, string> | null
): ParsedDate | null {
  if (!customFields) return null;
  for (const [key, raw] of Object.entries(customFields)) {
    if (!raw) continue;
    // Match "Birthday", "Birthdate", "Date of Birth", "DOB", "Born".
    if (!BIRTHDAY_KEY_RE.test(key.toLowerCase())) continue;
    const parsed = parseDateValue(raw);
    if (parsed) return parsed;
  }
  return null;
}

// Parse the canonical value stored in Contact.birthday ("YYYY-MM-DD" or
// "--MM-DD"), falling back to freeform parsing for legacy/hand-entered values.
export function parseStoredBirthday(stored: string): ParsedDate | null {
  const s = stored.trim();

  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) {
    const month = +full[2] - 1;
    const day = +full[3];
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return { year: +full[1], month, day };
    }
  }

  const partial = s.match(/^--(\d{2})-(\d{2})$/);
  if (partial) {
    const month = +partial[1] - 1;
    const day = +partial[2];
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return { year: null, month, day };
    }
  }

  return parseDateValue(s);
}

// Normalize freeform user/AI input into the canonical stored form, or null when
// no month + day can be parsed.
export function normalizeBirthday(value: string): string | null {
  const p = parseStoredBirthday(value);
  if (!p) return null;
  const mm = String(p.month + 1).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return p.year != null ? `${p.year}-${mm}-${dd}` : `--${mm}-${dd}`;
}

// Human-friendly rendering: "May 14" or "May 14, 1990". Returns "" for empty
// and echoes back anything unparseable rather than dropping it.
export function formatBirthday(stored: string | null | undefined): string {
  if (!stored) return "";
  const p = parseStoredBirthday(stored);
  if (!p) return stored;
  const name = MONTH_NAMES[p.month] ?? "";
  return p.year != null ? `${name} ${p.day}, ${p.year}` : `${name} ${p.day}`;
}

// Pull a birthday out of AI-detected custom fields into the structured field,
// removing it from the custom-field map so it isn't shown twice.
export function liftBirthdayFromCustomFields(
  cf: Record<string, string> | null | undefined
): { birthday: string | null; customFields: Record<string, string> | null } {
  if (!cf) return { birthday: null, customFields: null };
  let birthday: string | null = null;
  const rest: Record<string, string> = {};
  for (const [key, value] of Object.entries(cf)) {
    if (birthday == null && value && BIRTHDAY_KEY_RE.test(key.toLowerCase())) {
      const norm = normalizeBirthday(value);
      if (norm) {
        birthday = norm;
        continue; // drop from custom fields — it now lives in the birthday field
      }
    }
    rest[key] = value;
  }
  return {
    birthday,
    customFields: Object.keys(rest).length > 0 ? rest : null,
  };
}

export type UpcomingBirthday = {
  contact: Contact;
  next: Date;
  daysUntil: number;
  turningAge: number | null;
};

const MS_PER_DAY = 86_400_000;

// Contacts with a parseable birthday falling within `windowDays`, soonest first.
export function computeUpcomingBirthdays(
  contacts: Contact[],
  windowDays = 60,
  now: Date = new Date()
): UpcomingBirthday[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayYear = today.getFullYear();

  return contacts
    .map((c) => {
      // Prefer the structured field; fall back to a birthday captured in
      // custom fields (legacy rows / AI-detected before this field existed).
      const bday = c.birthday
        ? parseStoredBirthday(c.birthday)
        : parseBirthday(c.customFields);
      if (!bday) return null;

      // Next occurrence of this month/day on/after today.
      let next = new Date(todayYear, bday.month, bday.day);
      next.setHours(0, 0, 0, 0);
      if (next.getTime() < today.getTime()) {
        next = new Date(todayYear + 1, bday.month, bday.day);
        next.setHours(0, 0, 0, 0);
      }

      const daysUntil = Math.round((next.getTime() - today.getTime()) / MS_PER_DAY);
      const turningAge = bday.year != null ? next.getFullYear() - bday.year : null;

      return { contact: c, next, daysUntil, turningAge };
    })
    .filter(
      (b): b is UpcomingBirthday => b !== null && b.daysUntil <= windowDays
    )
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

export function daysUntilBirthday(stored: string, now: Date = new Date()): number | null {
  const bday = parseStoredBirthday(stored);
  if (!bday) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), bday.month, bday.day);
  next.setHours(0, 0, 0, 0);
  if (next.getTime() < today.getTime()) {
    next = new Date(today.getFullYear() + 1, bday.month, bday.day);
    next.setHours(0, 0, 0, 0);
  }
  return Math.round((next.getTime() - today.getTime()) / MS_PER_DAY);
}
