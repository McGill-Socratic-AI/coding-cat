// Username policy — the authoritative, server-side copy.
//
// IMPORTANT: src/utils/username.ts is the same policy again, for instant
// feedback in the browser. CRA and Deno cannot share a file (see the header of
// supabase/functions/analyze/types.ts), so the rules are duplicated on purpose.
// Change one, change the other, and keep the third copy — the
// `profiles_username_policy` CHECK constraint in
// supabase/migrations/20261105000000_pseudonymous_accounts.sql — in step too.
// Both test suites assert the same table of cases
// (username_test.ts and src/utils/username.test.ts).
//
// The username is the only handle Coding Cat has for a student, so it must be
// impossible to use it to identify them:
//
//   * no '@' and no '.', so it cannot be an email address;
//   * no long digit run, so it cannot be a student number;
//   * a tight character set, so there is nothing clever left to smuggle in.
//
// It cannot stop someone typing their own name, so the sign-up page says not
// to in as many words.

export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 24;

/** Longest run of digits a username may contain. A student number is 9 long. */
export const MAX_DIGIT_RUN = 4;
/** Most digits a username may contain in total, however broken up. */
export const MAX_DIGITS_TOTAL = 6;

const SHAPE = /^[a-z][a-z0-9_-]{2,23}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
const DOTTED_HOST = /\.[a-z]{2,}$/;

// Handles a student must not be able to claim: they would let one student pose
// as course staff or as the app itself to another.
const RESERVED = new Set([
  "admin",
  "administrator",
  "root",
  "superuser",
  "moderator",
  "support",
  "staff",
  "teacher",
  "professor",
  "instructor",
  "grader",
  "codingcat",
  "coding-cat",
  "system",
  "anonymous",
  "null",
  "undefined",
]);

export type UsernameCheck =
  | { ok: true; username: string }
  | { ok: false; error: string };

/**
 * Trim and lower-case. Everything downstream — storage, uniqueness, lookup —
 * uses this form, so `Kitty` and `kitty` are one account and not two.
 */
export function normalizeUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function longestDigitRun(value: string): number {
  let best = 0;
  let run = 0;
  for (const ch of value) {
    if (ch >= "0" && ch <= "9") {
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
  for (const ch of value) if (ch >= "0" && ch <= "9") n += 1;
  return n;
}

/**
 * Check a raw username. Returns the normalized form to store on success.
 *
 * The order of the checks is the order of the error messages a student sees:
 * the email and student-number rules are tested before the generic shape rule
 * so that typing an address or an ID gets told *why* it was refused, rather
 * than the useless "usernames may only contain ...".
 */
export function validateUsername(raw: unknown): UsernameCheck {
  const username = normalizeUsername(raw);

  if (username.length === 0) {
    return { ok: false, error: "Choose a username." };
  }

  if (username.includes("@") || EMAIL_SHAPE.test(username) || DOTTED_HOST.test(username)) {
    return {
      ok: false,
      error:
        "A username cannot be an email address. Coding Cat never asks for your email.",
    };
  }

  if (longestDigitRun(username) > MAX_DIGIT_RUN || digitCount(username) > MAX_DIGITS_TOTAL) {
    return {
      ok: false,
      error:
        "That looks like a student number. Pick a nickname instead — never your student number.",
    };
  }

  if (username.length < MIN_USERNAME_LEN || username.length > MAX_USERNAME_LEN) {
    return {
      ok: false,
      error:
        `A username must be ${MIN_USERNAME_LEN}-${MAX_USERNAME_LEN} characters long.`,
    };
  }

  if (!SHAPE.test(username)) {
    return {
      ok: false,
      error:
        "A username must start with a letter and use only letters, digits, hyphens and underscores.",
    };
  }

  if (RESERVED.has(username)) {
    return { ok: false, error: "That username is reserved. Please choose another." };
  }

  return { ok: true, username };
}
