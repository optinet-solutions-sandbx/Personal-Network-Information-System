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
    const k = key.toLowerCase();
    // Match "Birthday", "Birthdate", "Date of Birth", "DOB", "Born" —
    // but NOT "Birth Year" alone (year only, no day to place).
    if (!/birth\s*day|birth\s*date|date of birth|\bdob\b|\bborn\b/.test(k)) continue;
    const parsed = parseDateValue(raw);
    if (parsed) return parsed;
  }
  return null;
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
      const bday = parseBirthday(c.customFields);
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
