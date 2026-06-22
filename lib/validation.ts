// Pure input-validation helpers shared by the contact/note API routes.
// Kept framework-free so they're trivially unit-testable.

import { normalizeBirthday } from "@/lib/birthdays";

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
  birthday: 60, // generous cap on the raw input before normalization
  howWeMet: 4000,
  customFieldKey: 100,
  customFieldValue: 4000,
  customFieldCount: 50,
  noteContent: 20000,
  noteAudioUrl: 2000, // Supabase Storage public URL for a voice recording
  noteImageCount: 4, // photos per note (mirror MAX_NOTE_IMAGES in lib/image.ts)
  noteImageChars: 8_000_000, // ~6MB per downscaled data URL — generous upper bound
  // Immutable creation-source archive (Contact.sourceText / sourceImages). Text
  // matches the note cap; image count is more generous than a note (the add flow
  // can span several messages) but still bounded so a row can't grow unboundedly.
  sourceText: 20000,
  sourceImageCount: 10,
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
  birthday: string | null;
  howWeMet: string | null;
  customFields: Record<string, string> | null;
  followUpCadence: string | null;
  followUpCadenceDays: number | null;
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

  if (!opts.partial || "birthday" in b) {
    const raw = clean(b.birthday);
    if (!raw) {
      out.birthday = null;
    } else if (raw.length > LIMITS.birthday) {
      return { ok: false, error: "birthday is too long" };
    } else {
      const normalized = normalizeBirthday(raw);
      if (!normalized) {
        return {
          ok: false,
          error:
            "birthday isn't a recognizable date — try e.g. “May 14”, “May 14 1990”, or “1990-05-14”",
        };
      }
      out.birthday = normalized;
    }
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

  const VALID_CADENCES = ["weekly", "monthly", "quarterly", "annually", "custom"];
  if (!opts.partial || "followUpCadence" in b) {
    const val = clean(b.followUpCadence);
    if (val && !VALID_CADENCES.includes(val)) {
      return { ok: false, error: "invalid followUpCadence value" };
    }
    out.followUpCadence = val;
  }

  if (!opts.partial || "followUpCadenceDays" in b) {
    const raw = b.followUpCadenceDays;
    if (raw == null) {
      out.followUpCadenceDays = null;
    } else if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 3650) {
      return { ok: false, error: "followUpCadenceDays must be an integer between 1 and 3650" };
    } else {
      out.followUpCadenceDays = raw;
    }
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

// Photo attachments on a note: an array of image data URLs. Absent/empty is
// valid (text-only note). Returns the cleaned array on success.
export function validateNoteImages(value: unknown): ValidationResult<string[]> {
  return validateImageDataUrls(value, LIMITS.noteImageCount, "photos per note");
}

// Optional voice-recording URL on a note. Absent/empty -> null. Must be an
// http(s) URL within the length cap (it points at Supabase Storage).
export function validateNoteAudioUrl(
  value: unknown
): ValidationResult<string | null> {
  if (value == null || value === "") return { ok: true, data: null };
  if (typeof value !== "string") {
    return { ok: false, error: "audioUrl must be a string" };
  }
  const url = value.trim();
  if (url.length > LIMITS.noteAudioUrl) {
    return { ok: false, error: "audioUrl is too long" };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "audioUrl must be an http(s) URL" };
  }
  return { ok: true, data: url };
}

// Shared image-data-URL array validator. Each item must be an image data URL
// within the per-image size cap; the array is bounded by `maxCount`.
function validateImageDataUrls(
  value: unknown,
  maxCount: number,
  label: string
): ValidationResult<string[]> {
  if (value == null) return { ok: true, data: [] };
  if (!Array.isArray(value)) return { ok: false, error: "images must be a list" };
  if (value.length > maxCount) {
    return { ok: false, error: `at most ${maxCount} ${label}` };
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.startsWith("data:image/")) {
      return { ok: false, error: "each photo must be an image data URL" };
    }
    if (item.length > LIMITS.noteImageChars) {
      return { ok: false, error: "a photo is too large" };
    }
    out.push(item);
  }
  return { ok: true, data: out };
}

// The immutable creation-source archive (Contact.sourceText / sourceImages),
// accepted only at create time. Both parts are optional; returns cleaned values
// (text trimmed/capped, images validated). Validated separately from
// validateContact so the source can never be mutated through a PATCH.
export function validateContactSource(
  body: unknown
): ValidationResult<{ sourceText: string | null; sourceImages: string[] }> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  let sourceText: string | null = null;
  if (b.sourceText != null) {
    if (typeof b.sourceText !== "string") {
      return { ok: false, error: "sourceText must be a string" };
    }
    const trimmed = b.sourceText.trim();
    if (trimmed.length > LIMITS.sourceText) {
      return { ok: false, error: "sourceText is too long" };
    }
    sourceText = trimmed.length > 0 ? trimmed : null;
  }

  const imgs = validateImageDataUrls(
    b.sourceImages,
    LIMITS.sourceImageCount,
    "source photos"
  );
  if (!imgs.ok) return imgs;

  return { ok: true, data: { sourceText, sourceImages: imgs.data } };
}
