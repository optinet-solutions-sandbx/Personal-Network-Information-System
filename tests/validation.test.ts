import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  validateContact,
  validateCustomFields,
  validateNoteContent,
  validateNoteImages,
  validateAttachmentMeta,
  validateWorkspaceCreate,
  validateWorkspaceSwitch,
  validateWorkspaceUpdate,
  validateInviteCreate,
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

describe("validateNoteImages", () => {
  it("treats absent/null as an empty list", () => {
    const a = validateNoteImages(undefined);
    const b = validateNoteImages(null);
    expect(a.ok && a.data.length === 0).toBe(true);
    expect(b.ok && b.data.length === 0).toBe(true);
  });
  it("accepts image data URLs", () => {
    const res = validateNoteImages(["data:image/png;base64,AAAA", "data:image/jpeg;base64,BBBB"]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.length).toBe(2);
  });
  it("rejects non-arrays and non-image strings", () => {
    expect(validateNoteImages("data:image/png;base64,AAAA").ok).toBe(false);
    expect(validateNoteImages(["not-a-data-url"]).ok).toBe(false);
    expect(validateNoteImages(["data:text/plain;base64,AAAA"]).ok).toBe(false);
  });
  it("rejects more than the per-note cap", () => {
    const many = Array.from({ length: LIMITS.noteImageCount + 1 }, () => "data:image/png;base64,AAAA");
    expect(validateNoteImages(many).ok).toBe(false);
  });
  it("rejects an oversized photo", () => {
    expect(validateNoteImages(["data:image/png;base64," + "A".repeat(LIMITS.noteImageChars)]).ok).toBe(false);
  });
});

describe("validateAttachmentMeta", () => {
  const base = {
    filename: "deck.pdf",
    mimeType: "application/pdf",
    size: 1024,
    storagePath: "user-1/contact-1/123-abc-deck.pdf",
  };

  it("accepts well-formed metadata and trims the filename", () => {
    const res = validateAttachmentMeta({ ...base, filename: "  deck.pdf  " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.filename).toBe("deck.pdf");
      expect(res.data.mimeType).toBe("application/pdf");
      expect(res.data.size).toBe(1024);
      expect(res.data.noteId).toBeNull();
    }
  });

  it("defaults a missing mimeType to octet-stream", () => {
    const res = validateAttachmentMeta({ ...base, mimeType: undefined });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.mimeType).toBe("application/octet-stream");
  });

  it("captures an optional noteId", () => {
    const res = validateAttachmentMeta({ ...base, noteId: " note-9 " });
    expect(res.ok && res.data.noteId).toBe("note-9");
  });

  it("requires filename and storagePath", () => {
    expect(validateAttachmentMeta({ ...base, filename: "  " }).ok).toBe(false);
    expect(validateAttachmentMeta({ ...base, storagePath: "" }).ok).toBe(false);
  });

  it("rejects a non-integer or negative size", () => {
    expect(validateAttachmentMeta({ ...base, size: 1.5 }).ok).toBe(false);
    expect(validateAttachmentMeta({ ...base, size: -1 }).ok).toBe(false);
    expect(validateAttachmentMeta({ ...base, size: "1024" }).ok).toBe(false);
  });

  it("rejects a file over the size cap", () => {
    const res = validateAttachmentMeta({ ...base, size: LIMITS.attachmentMaxBytes + 1 });
    expect(res.ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(validateAttachmentMeta(null).ok).toBe(false);
    expect(validateAttachmentMeta("nope").ok).toBe(false);
  });
});

describe("validateWorkspaceCreate", () => {
  it("requires a non-empty name", () => {
    expect(validateWorkspaceCreate({}).ok).toBe(false);
    expect(validateWorkspaceCreate({ name: "   " }).ok).toBe(false);
  });

  it("trims and returns the name", () => {
    const res = validateWorkspaceCreate({ name: "  Acme Team  " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.name).toBe("Acme Team");
  });

  it("rejects a name over the length cap", () => {
    const res = validateWorkspaceCreate({ name: "x".repeat(LIMITS.workspaceName + 1) });
    expect(res.ok).toBe(false);
  });

  it("rejects non-object bodies", () => {
    expect(validateWorkspaceCreate(null).ok).toBe(false);
    expect(validateWorkspaceCreate("nope").ok).toBe(false);
    expect(validateWorkspaceCreate(["a"]).ok).toBe(false);
  });
});

describe("validateWorkspaceSwitch", () => {
  it("requires a workspaceId", () => {
    expect(validateWorkspaceSwitch({}).ok).toBe(false);
    expect(validateWorkspaceSwitch({ workspaceId: "  " }).ok).toBe(false);
  });

  it("trims and returns the workspaceId", () => {
    const res = validateWorkspaceSwitch({ workspaceId: "  ws_123  " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.workspaceId).toBe("ws_123");
  });

  it("rejects non-object bodies", () => {
    expect(validateWorkspaceSwitch(null).ok).toBe(false);
    expect(validateWorkspaceSwitch(["a"]).ok).toBe(false);
  });
});

describe("validateWorkspaceUpdate", () => {
  it("requires at least one field", () => {
    expect(validateWorkspaceUpdate({}).ok).toBe(false);
  });

  it("trims name and rejects a blank or over-long name", () => {
    const res = validateWorkspaceUpdate({ name: "  Acme  " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.name).toBe("Acme");
    expect(validateWorkspaceUpdate({ name: "   " }).ok).toBe(false);
    expect(validateWorkspaceUpdate({ name: "x".repeat(LIMITS.workspaceName + 1) }).ok).toBe(false);
  });

  it("allows clearing description with null and caps its length", () => {
    const cleared = validateWorkspaceUpdate({ description: null });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.data.description).toBeNull();
    expect(validateWorkspaceUpdate({ description: "x".repeat(LIMITS.workspaceDescription + 1) }).ok).toBe(false);
  });

  it("accepts an image data URL avatar, clears on empty, rejects non-image", () => {
    const ok = validateWorkspaceUpdate({ avatar: "data:image/jpeg;base64,abc" });
    expect(ok.ok).toBe(true);
    const cleared = validateWorkspaceUpdate({ avatar: "" });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.data.avatar).toBeNull();
    expect(validateWorkspaceUpdate({ avatar: "http://x/y.png" }).ok).toBe(false);
  });
});

describe("validateInviteCreate", () => {
  it("defaults role to member and never-expires", () => {
    const res = validateInviteCreate({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ role: "member", expiresInMinutes: null });
  });

  it("accepts member/admin and rejects other roles", () => {
    expect(validateInviteCreate({ role: "admin" }).ok).toBe(true);
    expect(validateInviteCreate({ role: "owner" }).ok).toBe(false);
    expect(validateInviteCreate({ role: "guest" }).ok).toBe(false);
  });

  it("validates expiresInMinutes bounds", () => {
    const ok = validateInviteCreate({ expiresInMinutes: 60 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.expiresInMinutes).toBe(60);
    expect(validateInviteCreate({ expiresInMinutes: 0 }).ok).toBe(false);
    expect(validateInviteCreate({ expiresInMinutes: 1.5 }).ok).toBe(false);
    expect(validateInviteCreate({ expiresInMinutes: LIMITS.inviteMaxMinutes + 1 }).ok).toBe(false);
    expect(validateInviteCreate({ expiresInMinutes: null }).ok).toBe(true);
  });
});
