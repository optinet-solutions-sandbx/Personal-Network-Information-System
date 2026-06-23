import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
  __resetEncryptionKeyCache,
} from "@/lib/crypto";

// A deterministic 32-byte test key (64 hex chars).
const TEST_KEY = "0".repeat(64);

describe("crypto (token encryption)", () => {
  beforeEach(() => {
    __resetEncryptionKeyCache();
  });

  it("is disabled with no key", () => {
    delete process.env.CONNECTION_ENC_KEY;
    __resetEncryptionKeyCache();
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow();
  });

  it("round-trips a secret with a valid key", () => {
    process.env.CONNECTION_ENC_KEY = TEST_KEY;
    __resetEncryptionKeyCache();
    expect(isEncryptionConfigured()).toBe(true);
    const secret = "refresh-token-abc-123";
    const enc = encryptSecret(secret);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain(secret); // not stored in the clear
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    process.env.CONNECTION_ENC_KEY = TEST_KEY;
    __resetEncryptionKeyCache();
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails to decrypt tampered ciphertext", () => {
    process.env.CONNECTION_ENC_KEY = TEST_KEY;
    __resetEncryptionKeyCache();
    const enc = encryptSecret("secret");
    // Flip a character in the base64 body.
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A") + "=";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects an invalid-length key", () => {
    process.env.CONNECTION_ENC_KEY = "tooshort";
    __resetEncryptionKeyCache();
    expect(isEncryptionConfigured()).toBe(false);
  });
});
