// Birthday stored as "MM-DD" (no year) or "MM-DD-YYYY" (with year).

type BirthdayParts = { month: number; day: number; year?: number };

export function parseBirthday(birthday: string): BirthdayParts | null {
  const parts = birthday.trim().split("-");
  if (parts.length === 2) {
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
  }
  if (parts.length === 3) {
    // Support both MM-DD-YYYY and legacy YYYY-MM-DD
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    const c = parseInt(parts[2], 10);
    if (a > 1900) {
      // YYYY-MM-DD (legacy)
      if (b >= 1 && b <= 12 && c >= 1 && c <= 31) return { month: b, day: c, year: a };
    } else {
      // MM-DD-YYYY
      if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && c > 1900) return { month: a, day: b, year: c };
    }
  }
  return null;
}

export function formatBirthday(birthday: string): string {
  const p = parseBirthday(birthday);
  if (!p) return birthday;
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return p.year ? `${mm}-${dd}-${p.year}` : `${mm}-${dd}`;
}

export function daysUntilBirthday(birthday: string): number | null {
  const p = parseBirthday(birthday);
  if (!p) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(today.getFullYear(), p.month - 1, p.day);
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.floor((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
