// Recovery codes: generation, hashing and constant-time verification.
//
// With no email address on the account there is no "send me a reset link", so a
// code shown once at registration is the student's only way back in. It is
// therefore a password-equivalent secret and is stored exactly like one: salted,
// hashed, never logged, and never returned to the browser after the single
// moment it is issued.
//
// Why a plain salted SHA-256 rather than bcrypt/scrypt: the code is generated
// here from `crypto.getRandomValues`, not chosen by a human, and carries 100
// bits of entropy. There is no dictionary to run and no password to stretch —
// the salt is there only to keep identical codes from sharing a digest and to
// make precomputation pointless.

// Crockford base32: no I, L, O or U, so a hand-copied code cannot be misread as
// 1/0 or turn into an unfortunate word.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const GROUP_LEN = 5;
const GROUPS = 4;
/** 20 characters of base32 = 100 bits. */
export const RECOVERY_CODE_LEN = GROUP_LEN * GROUPS;

const HASH_SCHEME = "s256";
const SALT_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * A fresh code, grouped for reading aloud and typing back:
 * `A1B2C-D3E4F-G5H6J-K7M8N`.
 */
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(RECOVERY_CODE_LEN);
  crypto.getRandomValues(bytes);
  // Rejection-free because 256 is a multiple of the 32-character alphabet, so
  // the modulo introduces no bias.
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) {
    groups.push(chars.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(""));
  }
  return groups.join("-");
}

/**
 * Accept the code however the student typed it back: lower case, spaces
 * instead of hyphens, and the characters Crockford treats as aliases
 * (O for 0, I/L for 1).
 */
export function normalizeRecoveryCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** `s256$<salt hex>$<digest hex>` — the format stored in account_recovery. */
export async function hashRecoveryCode(
  code: string,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(SALT_BYTES)),
): Promise<string> {
  const digest = await digestWithSalt(normalizeRecoveryCode(code), salt);
  return `${HASH_SCHEME}$${toHex(salt)}$${toHex(digest)}`;
}

async function digestWithSalt(
  normalized: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const codeBytes = new TextEncoder().encode(normalized);
  const input = new Uint8Array(salt.length + codeBytes.length);
  input.set(salt, 0);
  input.set(codeBytes, salt.length);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(digest);
}

/** Length-independent, value-independent comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  // Compare over a fixed width so a wrong length cannot be detected from how
  // long the comparison took.
  const width = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < width; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * True when `raw` is the code `stored` was made from. Any malformed or
 * unknown-scheme stored value verifies as false rather than throwing: a
 * corrupt row must not turn into a 500 that tells an attacker it exists.
 */
export async function verifyRecoveryCode(
  raw: unknown,
  stored: string | null | undefined,
): Promise<boolean> {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== HASH_SCHEME) return false;
  const salt = fromHex(parts[1]);
  if (!salt) return false;

  const normalized = normalizeRecoveryCode(raw);
  if (normalized.length === 0) return false;

  const digest = await digestWithSalt(normalized, salt);
  return timingSafeEqual(toHex(digest), parts[2]);
}
