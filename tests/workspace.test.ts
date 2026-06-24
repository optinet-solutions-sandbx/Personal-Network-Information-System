import { describe, it, expect } from "vitest";
import { roleAtLeast, inviteIsValid, generateInviteToken } from "@/lib/workspace";

describe("roleAtLeast", () => {
  it("respects the owner > admin > member hierarchy", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("owner", "owner")).toBe(true);
    expect(roleAtLeast("admin", "member")).toBe(true);
    expect(roleAtLeast("admin", "owner")).toBe(false);
    expect(roleAtLeast("member", "admin")).toBe(false);
    expect(roleAtLeast("member", "member")).toBe(true);
  });
});

describe("inviteIsValid", () => {
  const now = new Date("2026-06-24T12:00:00Z");

  it("is valid when not revoked and not expired", () => {
    expect(inviteIsValid({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(
      inviteIsValid({ revokedAt: null, expiresAt: new Date("2026-06-24T13:00:00Z") }, now)
    ).toBe(true);
  });

  it("is invalid when revoked", () => {
    expect(inviteIsValid({ revokedAt: now, expiresAt: null }, now)).toBe(false);
  });

  it("is invalid when expired (at or before now)", () => {
    expect(
      inviteIsValid({ revokedAt: null, expiresAt: new Date("2026-06-24T11:59:59Z") }, now)
    ).toBe(false);
    expect(inviteIsValid({ revokedAt: null, expiresAt: now }, now)).toBe(false);
  });
});

describe("generateInviteToken", () => {
  it("produces distinct, URL-safe tokens", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet, no padding
    expect(a.length).toBeGreaterThanOrEqual(42);
  });
});
