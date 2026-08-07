// Pseudonym derivation — the one piece of this feature that the privacy story
// actually rests on.
//
//   pseudonym = HMAC-SHA256(RESEARCH_SALT, auth.uid())  as lowercase hex
//
// Why HMAC and not a plain hash of the UUID: a bare SHA-256(uuid) is trivially
// reversible by anyone who can enumerate candidate UUIDs, and every user id in
// this system is already sitting in auth.users. Without a secret key the
// "pseudonym" would be a rename, not a protection. The salt is what makes the
// mapping uncomputable to someone holding only the database.
//
// The salt therefore must NEVER be: committed, written to a table, logged,
// returned in a response, or shipped to the browser. It lives only as an Edge
// Function secret (`supabase secrets set RESEARCH_SALT=...`).
//
// Rotating the salt orphans every existing row — grades written under the old
// salt can no longer be matched to usage. Rotate only in step with a fresh
// study, never mid-term.

export class PseudonymConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PseudonymConfigError";
  }
}

// 32 hex chars = 128 bits. Below this the salt is guessable by brute force,
// which would defeat the entire construction, so we refuse to run rather than
// quietly provide false assurance.
const MIN_SALT_LEN = 32;

let cachedKey: CryptoKey | null = null;
let cachedSaltFingerprint: string | null = null;

function readSalt(): string {
  const salt = Deno.env.get("RESEARCH_SALT");
  if (!salt) {
    throw new PseudonymConfigError("RESEARCH_SALT is not set");
  }
  if (salt.length < MIN_SALT_LEN) {
    throw new PseudonymConfigError(
      `RESEARCH_SALT must be at least ${MIN_SALT_LEN} characters`,
    );
  }
  return salt;
}

async function getKey(): Promise<CryptoKey> {
  const salt = readSalt();

  // Cache the imported key across invocations of a warm isolate, but key the
  // cache on the salt's length + a cheap marker so a changed secret cannot be
  // served from a stale isolate. (Deno Deploy recycles isolates; a redeploy
  // creates new ones, but being explicit costs nothing.)
  const fingerprint = `${salt.length}:${salt.slice(0, 2)}`;
  if (cachedKey && cachedSaltFingerprint === fingerprint) return cachedKey;

  cachedKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false, // not extractable
    ["sign"],
  );
  cachedSaltFingerprint = fingerprint;
  return cachedKey;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Derive the stable research pseudonym for a Supabase user id.
 *
 * Must produce byte-identical output to the research export script, which
 * applies the same HMAC on the other side of the join. See
 * scripts/research-export.mjs — if you change anything here, change it there.
 */
export async function computePseudonym(userId: string): Promise<string> {
  if (!userId) {
    throw new PseudonymConfigError(
      "cannot derive a pseudonym from an empty user id",
    );
  }
  const key = await getKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(userId),
  );
  return toHex(sig);
}

// Exposed for tests only: lets a test reset the memoised key between cases
// that swap RESEARCH_SALT.
export function __resetKeyCacheForTests(): void {
  cachedKey = null;
  cachedSaltFingerprint = null;
}
