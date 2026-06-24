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
  // Self-profile (User row, see /api/profile).
  bio: 2000,
  website: 500,
  avatarChars: 3_000_000, // ~2.2MB decoded — generous cap on the downscaled avatar data URL
  // File attachments (Attachment row, see /api/contacts/[id]/attachments). The
  // bytes live in Supabase Storage; only this metadata hits the DB.
  attachmentFilename: 255,
  attachmentMimeType: 150,
  attachmentStoragePath: 1024,
  attachmentMaxBytes: 25 * 1024 * 1024, // 25MB — mirror MAX_ATTACHMENT_BYTES in lib/attachments.ts and the bucket cap
  // Workspaces (team workspace name in the sidebar switcher).
  workspaceName: 100,
  workspaceDescription: 500,
  // Upper bound on an invite link's lifetime: 1 year (in minutes). null = never.
  inviteMaxMinutes: 525600,
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

export type CleanProfile = {
  name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  bio: string | null;
  website: string | null;
  phone: string | null;
  avatar: string | null;
};

// Validate a self-profile (User row) payload from PUT /api/profile. Every field
// is optional and only the keys present in `body` are returned (partial update),
// so the editor can save a single field without clobbering the rest.
export function validateProfile(
  body: unknown
): ValidationResult<Partial<CleanProfile>> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid body" };
  }
  const b = body as Record<string, unknown>;
  const out: Partial<CleanProfile> = {};

  // Plain trimmed-and-capped string fields. (bio/website use the new caps; the
  // rest reuse the contact caps so limits stay consistent across the app.)
  const STRING_FIELDS = [
    ["name", LIMITS.name],
    ["title", LIMITS.title],
    ["company", LIMITS.company],
    ["location", LIMITS.location],
    ["bio", LIMITS.bio],
    ["website", LIMITS.website],
    ["phone", LIMITS.phone],
  ] as const;

  for (const [field, cap] of STRING_FIELDS) {
    if (!(field in b)) continue;
    const value = clean(b[field]);
    if (value && value.length > cap) {
      return { ok: false, error: `${field} must be ≤ ${cap} characters` };
    }
    out[field] = value;
  }

  if ("avatar" in b) {
    const raw = b.avatar;
    if (raw == null || raw === "") {
      out.avatar = null;
    } else if (typeof raw !== "string" || !raw.startsWith("data:image/")) {
      return { ok: false, error: "avatar must be an image data URL" };
    } else if (raw.length > LIMITS.avatarChars) {
      return { ok: false, error: "avatar image is too large" };
    } else {
      out.avatar = raw;
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

export function validateSentMessageBody(body: unknown):
  | { ok: true; data: { contactId: string; body: string; method: "email" | "clipboard" } }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" }
  }
  const b = body as Record<string, unknown>
  if (typeof b.contactId !== "string" || !b.contactId.trim()) {
    return { ok: false, error: "contactId is required" }
  }
  if (typeof b.body !== "string" || !b.body.trim()) {
    return { ok: false, error: "body is required" }
  }
  if (b.method !== "email" && b.method !== "clipboard") {
    return { ok: false, error: 'method must be "email" or "clipboard"' }
  }
  return {
    ok: true,
    data: {
      contactId: b.contactId.trim(),
      body: b.body.trim(),
      method: b.method,
    },
  }
}

export type CleanAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  noteId: string | null;
};

// Validate the metadata the client posts after uploading a file to Storage.
// The route additionally checks that storagePath sits in the caller's own
// folder (and that any noteId belongs to the contact) — see the attachments
// route — so this only validates shape, length, and the size cap.
export function validateAttachmentMeta(
  body: unknown
): ValidationResult<CleanAttachment> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid body" };
  }
  const b = body as Record<string, unknown>;

  const filename = clean(b.filename);
  if (!filename) return { ok: false, error: "filename is required" };
  if (filename.length > LIMITS.attachmentFilename) {
    return { ok: false, error: "filename is too long" };
  }

  const storagePath = clean(b.storagePath);
  if (!storagePath) return { ok: false, error: "storagePath is required" };
  if (storagePath.length > LIMITS.attachmentStoragePath) {
    return { ok: false, error: "storagePath is too long" };
  }

  const mimeType = clean(b.mimeType) ?? "application/octet-stream";
  if (mimeType.length > LIMITS.attachmentMimeType) {
    return { ok: false, error: "mimeType is too long" };
  }

  const size = b.size;
  if (
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 0 ||
    size > LIMITS.attachmentMaxBytes
  ) {
    return {
      ok: false,
      error: `file must be ≤ ${Math.floor(LIMITS.attachmentMaxBytes / (1024 * 1024))} MB`,
    };
  }

  let noteId: string | null = null;
  if (b.noteId != null && b.noteId !== "") {
    if (typeof b.noteId !== "string") {
      return { ok: false, error: "noteId must be a string" };
    }
    noteId = b.noteId.trim();
  }

  return { ok: true, data: { filename, mimeType, size, storagePath, noteId } };
}

export function validateNoteImages(value: unknown): ValidationResult<string[]> {
  return validateImageDataUrls(value, LIMITS.noteImageCount, "photos per note");
}

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

// ── Workspaces ──────────────────────────────────────────────────────────────

// Validate the body of POST /api/workspaces (create a new team workspace).
export function validateWorkspaceCreate(
  body: unknown
): ValidationResult<{ name: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid body" };
  }
  const name = clean((body as Record<string, unknown>).name);
  if (!name) return { ok: false, error: "name is required" };
  if (name.length > LIMITS.workspaceName) {
    return { ok: false, error: "name is too long" };
  }
  return { ok: true, data: { name } };
}

// Validate the body of POST /api/workspaces/switch. Membership is checked
// against the DB in the route — this only validates shape.
export function validateWorkspaceSwitch(
  body: unknown
): ValidationResult<{ workspaceId: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid body" };
  }
  const workspaceId = clean((body as Record<string, unknown>).workspaceId);
  if (!workspaceId) return { ok: false, error: "workspaceId is required" };
  return { ok: true, data: { workspaceId } };
}

export type CleanWorkspaceUpdate = {
  name?: string;
  description?: string | null;
  avatar?: string | null;
};

// Validate a PATCH to /api/workspaces/[id] (workspace profile). Partial: only
// the keys present in the body are validated and returned. Mirrors
// validateProfile's avatar handling.
export function validateWorkspaceUpdate(
  body: unknown
): ValidationResult<CleanWorkspaceUpdate> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid body" };
  }
  const b = body as Record<string, unknown>;
  const out: CleanWorkspaceUpdate = {};

  if (b.name !== undefined) {
    const name = clean(b.name);
    if (!name) return { ok: false, error: "name is required" };
    if (name.length > LIMITS.workspaceName) {
      return { ok: false, error: "name is too long" };
    }
    out.name = name;
  }

  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== "string") {
      return { ok: false, error: "description must be a string" };
    }
    const desc = clean(b.description);
    if (desc && desc.length > LIMITS.workspaceDescription) {
      return { ok: false, error: "description is too long" };
    }
    out.description = desc; // null clears it
  }

  if (b.avatar !== undefined) {
    if (b.avatar === null || b.avatar === "") {
      out.avatar = null;
    } else if (typeof b.avatar !== "string" || !b.avatar.startsWith("data:image/")) {
      return { ok: false, error: "avatar must be an image data URL" };
    } else if (b.avatar.length > LIMITS.avatarChars) {
      return { ok: false, error: "avatar image is too large" };
    } else {
      out.avatar = b.avatar;
    }
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, error: "no fields to update" };
  }
  return { ok: true, data: out };
}

// Validate POST /api/workspaces/[id]/invites. role defaults to "member";
// expiresInMinutes is null (never) or a positive integer up to the cap.
export function validateInviteCreate(
  body: unknown
): ValidationResult<{ role: "member" | "admin"; expiresInMinutes: number | null }> {
  const b = (body && typeof body === "object" && !Array.isArray(body)
    ? body
    : {}) as Record<string, unknown>;

  let role: "member" | "admin" = "member";
  if (b.role !== undefined) {
    if (b.role !== "member" && b.role !== "admin") {
      return { ok: false, error: 'role must be "member" or "admin"' };
    }
    role = b.role;
  }

  let expiresInMinutes: number | null = null;
  if (b.expiresInMinutes !== undefined && b.expiresInMinutes !== null) {
    const n = Number(b.expiresInMinutes);
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.inviteMaxMinutes) {
      return {
        ok: false,
        error: `expiresInMinutes must be an integer 1–${LIMITS.inviteMaxMinutes} or null`,
      };
    }
    expiresInMinutes = n;
  }

  return { ok: true, data: { role, expiresInMinutes } };
}
