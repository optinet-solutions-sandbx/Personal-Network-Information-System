// Symmetric encryption for secrets at rest — OAuth access/refresh tokens for
// connected accounts (see prisma `Connection`). AES-256-GCM (authenticated):
// tampering with the ciphertext fails decryption rather than silently returning
// garbage.
//
// The key comes from CONNECTION_ENC_KEY: 32 bytes, as 64 hex chars or base64.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Connections are an OPTIONAL feature, mirroring the rest of the app (auth /
// storage are optional too): with no key set, isEncryptionConfigured() is false
// and the connections UI/routes report the feature as unavailable instead of
// storing tokens in the clear.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16;
const PREFIX = "v1:"; // versions the on-disk format so it can evolve

let cachedKey: Buffer | null | undefined; // undefined = not yet resolved

// Parse CONNECTION_ENC_KEY into a 32-byte Buffer, or null when unset/invalid.
function getKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.CONNECTION_ENC_KEY?.trim();
  if (!raw) return (cachedKey = null);

  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    try {
      const b = Buffer.from(raw, "base64");
      if (b.length === 32) key = b;
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== 32) {
    console.error(
      "CONNECTION_ENC_KEY is set but is not a valid 32-byte key (64 hex chars or base64); connections are disabled."
    );
    return (cachedKey = null);
  }
  return (cachedKey = key);
}

export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

// Encrypt plaintext -> "v1:<base64(iv|tag|ciphertext)>". Throws if no key is
// configured (callers should gate on isEncryptionConfigured first).
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) throw new Error("CONNECTION_ENC_KEY is not configured");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

// Decrypt a value produced by encryptSecret. Throws on a missing key, a bad
// format, or a failed authentication tag (tampering / wrong key).
export function decryptSecret(payload: string): string {
  const key = getKey();
  if (!key) throw new Error("CONNECTION_ENC_KEY is not configured");
  if (!payload.startsWith(PREFIX)) {
    throw new Error("unrecognized ciphertext format");
  }
  const buf = Buffer.from(payload.slice(PREFIX.length), "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}

// Test-only: drop the memoized key so a changed env var takes effect.
export function __resetEncryptionKeyCache() {
  cachedKey = undefined;
}
