// Pure input-validation helpers shared by the contact/note API routes.
// Kept framework-free so they're trivially unit-testable.

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Field length caps — generous, but enough to reject obviously abusive input
// and protect the DB / AI prompts from unbounded strings.
export const LIMITS = {
  name: 200,
  email: 320, // RFC 5321 max
  phone: 50,
  company: 200,
  title: 200,
  location: 200,
  tags: 500,
  howWeMet: 4000,
  customFieldKey: 100,
  customFieldValue: 4000,
  customFieldCount: 50,
  noteContent: 20000,
} as const;

// Loose, pragmatic email shape check (not full RFC). Empty is allowed upstream.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type CleanContact = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  location: string | null;
  tags: string | null;
  howWeMet: string | null;
  customFields: Record<string, string> | null;
};

const OPTIONAL_STRING_FIELDS = [
  "phone",
  "company",
  "title",
  "location",
  "tags",
  "howWeMet",
] as const;

// Validate a full or partial contact payload. With { partial: true } (PATCH),
// only the keys present in `body` are validated and returned.
export function validateContact(
  body: unknown,
  opts: { partial?: boolean } = {}
): ValidationResult<Partial<CleanContact>> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid body" };
  }
  const b = body as Record<string, unknown>;
  const out: Partial<CleanContact> = {};

  const nameProvided = "name" in b;
  if (!opts.partial || nameProvided) {
    const name = clean(b.name);
    if (!name) return { ok: false, error: "name is required" };
    if (name.length > LIMITS.name)
      return { ok: false, error: `name must be ≤ ${LIMITS.name} characters` };
    out.name = name;
  }

  if (!opts.partial || "email" in b) {
    const email = clean(b.email);
    if (email) {
      if (email.length > LIMITS.email)
        return { ok: false, error: "email is too long" };
      if (!isValidEmail(email))
        return { ok: false, error: "email is not a valid address" };
    }
    out.email = email;
  }

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (!opts.partial || field in b) {
      const value = clean(b[field]);
      if (value && value.length > LIMITS[field]) {
        return { ok: false, error: `${field} must be ≤ ${LIMITS[field]} characters` };
      }
      out[field] = value;
    }
  }

  if (!opts.partial || "customFields" in b) {
    const cf = validateCustomFields(b.customFields);
    if (!cf.ok) return cf;
    out.customFields = cf.data;
  }

  return { ok: true, data: out };
}

export function validateCustomFields(
  value: unknown
): ValidationResult<Record<string, string> | null> {
  if (value == null) return { ok: true, data: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "customFields must be an object" };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return { ok: true, data: null };
  if (entries.length > LIMITS.customFieldCount) {
    return {
      ok: false,
      error: `too many custom fields (max ${LIMITS.customFieldCount})`,
    };
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    const k = key.trim();
    if (!k) continue;
    if (k.length > LIMITS.customFieldKey) {
      return { ok: false, error: "custom field name is too long" };
    }
    const v = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (!v) continue;
    if (v.length > LIMITS.customFieldValue) {
      return { ok: false, error: `custom field "${k}" value is too long` };
    }
    out[k] = v;
  }
  return { ok: true, data: Object.keys(out).length > 0 ? out : null };
}

export function validateNoteContent(value: unknown): ValidationResult<string> {
  const content = clean(value);
  if (!content) return { ok: false, error: "content is required" };
  if (content.length > LIMITS.noteContent) {
    return { ok: false, error: "note is too long" };
  }
  return { ok: true, data: content };
}
