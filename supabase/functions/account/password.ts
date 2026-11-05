// Password policy — the authoritative, server-side copy.
// Mirrored in src/utils/username.ts for instant feedback in the browser; see
// the "keep in sync" note at the top of username.ts.
//
// Stricter than GoTrue's own `minimum_password_length`, which is the floor the
// Supabase project enforces and not a policy we want to depend on: this is the
// only secret standing between a student and their account, because there is no
// email address to fall back on.

export const MIN_PASSWORD_LEN = 8;
// bcrypt — what GoTrue hashes with — silently ignores anything past 72 bytes,
// so refuse longer input rather than accept a password whose tail does nothing.
export const MAX_PASSWORD_LEN = 72;

export type PasswordCheck = { ok: true } | { ok: false; error: string };

// UTF-8 byte length without TextEncoder, so this stays identical to the
// browser copy in src/utils/username.ts, which runs under a test environment
// that does not always provide it.
function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Lead of a surrogate pair: one 4-byte code point, two UTF-16 units.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}


export function validatePassword(
  raw: unknown,
  username: string = "",
): PasswordCheck {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "Choose a password." };
  }
  if (raw.length < MIN_PASSWORD_LEN) {
    return {
      ok: false,
      error: `A password must be at least ${MIN_PASSWORD_LEN} characters long.`,
    };
  }
  // Measured in bytes, which is what bcrypt truncates on: a 19-character
  // password of emoji is already over the limit.
  if (utf8Length(raw) > MAX_PASSWORD_LEN) {
    return {
      ok: false,
      error: `A password must be at most ${MAX_PASSWORD_LEN} characters long.`,
    };
  }
  if (username.length > 0 && raw.toLowerCase() === username.toLowerCase()) {
    return { ok: false, error: "Your password cannot be your username." };
  }
  return { ok: true };
}
