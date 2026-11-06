// Username and password policy — the browser's copy, for instant feedback.
//
// IMPORTANT: supabase/functions/account/username.ts and password.ts are the
// authoritative copies; the Edge Function re-checks everything here, so this
// file can never let anything through that the server would accept. CRA and
// Deno cannot share a file (see the header of
// supabase/functions/analyze/types.ts), so the rules are duplicated on purpose.
// Change one, change the other, and keep the third copy — the
// `profiles_username_policy` CHECK constraint in
// supabase/migrations/20261105000000_pseudonymous_accounts.sql — in step too.
// src/utils/username.test.ts and
// supabase/functions/account/username_test.ts assert the same table of cases.
//
// Why the rules are what they are: the username is the only handle Coding Cat
// has for a student, and it must not identify them. No '@' or '.' means it
// cannot be an email address; no long digit run means it cannot be a student
// number. It cannot stop someone typing their own name, which is why the
// sign-up page says not to in as many words.

export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 24;

/** Longest run of digits a username may contain. A student number is 9 long. */
export const MAX_DIGIT_RUN = 4;
/** Most digits a username may contain in total, however broken up. */
export const MAX_DIGITS_TOTAL = 6;

export const MIN_PASSWORD_LEN = 8;
// bcrypt — what Supabase hashes with — ignores anything past 72 bytes, so a
// longer password would silently have a dead tail.
export const MAX_PASSWORD_LEN = 72;

const SHAPE = /^[a-z][a-z0-9_-]{2,23}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
const DOTTED_HOST = /\.[a-z]{2,}$/;


export type UsernameCheck =
  | { ok: true; username: string }
  | { ok: false; error: string };

export type PasswordCheck = { ok: true } | { ok: false; error: string };

// UTF-8 byte length without TextEncoder, so this stays identical to the
// server copy in supabase/functions/account/password.ts, and works under a
// jsdom test environment that does not always provide it.
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


/** Trim and lower-case: `Kitty` and `kitty` are one account, not two. */
export function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function longestDigitRun(value: string): number {
  let best = 0;
  let run = 0;
  for (const ch of value) {
    if (ch >= '0' && ch <= '9') {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

function digitCount(value: string): number {
  let n = 0;
  for (const ch of value) if (ch >= '0' && ch <= '9') n += 1;
  return n;
}

/**
 * Check a raw username, returning the normalized form on success.
 *
 * The order of the checks is the order of the messages a student sees: the
 * email and student-number rules come before the generic shape rule so that
 * typing an address or an ID is told why, not just "invalid characters".
 */
export function validateUsername(raw: unknown): UsernameCheck {
  const username = normalizeUsername(raw);

  if (username.length === 0) {
    return { ok: false, error: 'Choose a username.' };
  }

  if (username.includes('@') || EMAIL_SHAPE.test(username) || DOTTED_HOST.test(username)) {
    return {
      ok: false,
      error: 'A username cannot be an email address. Coding Cat never asks for your email.',
    };
  }

  if (longestDigitRun(username) > MAX_DIGIT_RUN || digitCount(username) > MAX_DIGITS_TOTAL) {
    return {
      ok: false,
      error:
        'That looks like a student number. Pick a nickname instead — never your student number.',
    };
  }

  if (username.length < MIN_USERNAME_LEN || username.length > MAX_USERNAME_LEN) {
    return {
      ok: false,
      error: `A username must be ${MIN_USERNAME_LEN}-${MAX_USERNAME_LEN} characters long.`,
    };
  }

  if (!SHAPE.test(username)) {
    return {
      ok: false,
      error:
        'A username must start with a letter and use only letters, digits, hyphens and underscores.',
    };
  }

  return { ok: true, username };
}

export function validatePassword(raw: unknown, username: string = ''): PasswordCheck {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'Choose a password.' };
  }
  if (raw.length < MIN_PASSWORD_LEN) {
    return { ok: false, error: `A password must be at least ${MIN_PASSWORD_LEN} characters long.` };
  }
  // Measured in bytes, which is what bcrypt truncates on.
  if (utf8Length(raw) > MAX_PASSWORD_LEN) {
    return { ok: false, error: `A password must be at most ${MAX_PASSWORD_LEN} characters long.` };
  }
  if (username.length > 0 && raw.toLowerCase() === username.toLowerCase()) {
    return { ok: false, error: 'Your password cannot be your username.' };
  }
  return { ok: true };
}
