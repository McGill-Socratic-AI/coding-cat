// The three things a pseudonymous account can do: be created, be signed in to,
// and be recovered with its one-time code.
//
// All the policy lives here and all the I/O lives behind `AccountStore`, so the
// handler tests drive these flows end to end against an in-memory store.
//
// Two rules run through every branch:
//
//   * Nothing identifying is accepted or returned. The only fields a caller
//     sends are a username, a password and (for recovery) a code; the only
//     fields that come back are the username, the two session tokens and —
//     once — a recovery code. The placeholder email never leaves this module.
//   * A failed credential check says the same thing whichever half was wrong,
//     and nothing is logged about who attempted it.

import { corsHeaders } from "./cors.ts";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
} from "./recovery.ts";
import { generatePlaceholderEmail } from "./placeholder.ts";
import { validatePassword } from "./password.ts";
import { normalizeUsername, validateUsername } from "./username.ts";
import { type AccountStore, UsernameTakenError } from "./store.ts";
import type {
  AccountErrorKind,
  AccountResponse,
  AccountSession,
} from "./types.ts";

export interface AccountDeps {
  store: AccountStore;
  // Overridden in tests so a flow can assert on a known code / address.
  newRecoveryCode?: () => string;
  newPlaceholderEmail?: () => string;
}

const STATUS: Record<AccountErrorKind, number> = {
  invalid_input: 400,
  username_taken: 409,
  invalid_credentials: 401,
  invalid_recovery_code: 401,
  unknown: 500,
};

// One message for "no such username" and for "wrong password", so the sign-in
// form cannot be used to find out which usernames exist.
const BAD_CREDENTIALS = "Incorrect username or password.";
const BAD_RECOVERY = "That username and recovery code do not match.";

function json(body: AccountResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function fail(kind: AccountErrorKind, message: string): Response {
  return json({ ok: false, kind, message }, STATUS[kind]);
}

function ok(
  username: string,
  session: AccountSession | null,
  recoveryCode?: string,
): Response {
  return json({ ok: true, username, session, ...(recoveryCode ? { recoveryCode } : {}) }, 200);
}

/**
 * Resolve a username to its account and sign in with `password`.
 * Returns null for every failure, so no branch of the lookup is observable.
 */
async function authenticate(
  store: AccountStore,
  username: string,
  password: string,
): Promise<{ profileId: string; session: AccountSession } | null> {
  const profile = await store.findProfileByUsername(username);
  if (!profile) return null;
  const email = await store.loginEmailFor(profile.profileId);
  if (!email) return null;
  const session = await store.signIn(email, password);
  if (!session) return null;
  return { profileId: profile.profileId, session };
}

async function handleSignUp(
  body: Record<string, unknown>,
  deps: AccountDeps,
): Promise<Response> {
  const { store } = deps;

  const checkedName = validateUsername(body.username);
  if (!checkedName.ok) return fail("invalid_input", checkedName.error);
  const username = checkedName.username;

  const checkedPassword = validatePassword(body.password, username);
  if (!checkedPassword.ok) return fail("invalid_input", checkedPassword.error);
  const password = body.password as string;

  // A courtesy check only — the unique index on profiles.username is what
  // actually decides a race, below.
  if (await store.findProfileByUsername(username)) {
    return fail("username_taken", "That username is already taken.");
  }

  const email = (deps.newPlaceholderEmail ?? generatePlaceholderEmail)();
  const recoveryCode = (deps.newRecoveryCode ?? generateRecoveryCode)();
  const recoveryHash = await hashRecoveryCode(recoveryCode);

  let profileId: string;
  try {
    ({ profileId } = await store.createUser({ email, password, username }));
  } catch (e) {
    if (e instanceof UsernameTakenError) {
      return fail("username_taken", "That username is already taken.");
    }
    console.error("[account] signup createUser failed:", e);
    return fail("unknown", "Could not create the account. Please try again.");
  }

  try {
    await store.putRecoveryHash(profileId, recoveryHash);
  } catch (e) {
    // An account whose recovery code was never stored can never be recovered,
    // and the student does not yet know it exists. Roll it back so the username
    // stays free and they can simply try again.
    console.error("[account] signup could not store the recovery code:", e);
    try {
      await store.deleteUser(profileId);
    } catch (cleanupError) {
      console.error("[account] signup rollback failed:", cleanupError);
    }
    return fail("unknown", "Could not create the account. Please try again.");
  }

  // The account exists and its code is stored, so from here on the recovery
  // code must reach the student whatever else goes wrong — a session is a
  // convenience, the code is not recoverable.
  let session: AccountSession | null = null;
  try {
    session = await store.signIn(email, password);
  } catch (e) {
    console.error("[account] signup could not open a session:", e);
  }

  return ok(username, session, recoveryCode);
}

async function handleSignIn(
  body: Record<string, unknown>,
  deps: AccountDeps,
): Promise<Response> {
  const username = normalizeUsername(body.username);
  // Deliberately not validateUsername: an existing account whose handle
  // predates a policy change must still be able to sign in, and an unparseable
  // username is simply one that matches nothing.
  if (username.length === 0 || typeof body.password !== "string" || body.password.length === 0) {
    return fail("invalid_input", "Enter your username and password.");
  }

  let authed;
  try {
    authed = await authenticate(deps.store, username, body.password);
  } catch (e) {
    console.error("[account] signin failed:", e);
    return fail("unknown", "Could not sign you in. Please try again.");
  }
  if (!authed) return fail("invalid_credentials", BAD_CREDENTIALS);

  return ok(username, authed.session);
}

async function handleRecover(
  body: Record<string, unknown>,
  deps: AccountDeps,
): Promise<Response> {
  const { store } = deps;

  const username = normalizeUsername(body.username);
  if (username.length === 0 || typeof body.recoveryCode !== "string") {
    return fail("invalid_input", "Enter your username and your recovery code.");
  }

  const checkedPassword = validatePassword(body.password, username);
  if (!checkedPassword.ok) return fail("invalid_input", checkedPassword.error);
  const password = body.password as string;

  let profileId: string;
  try {
    const profile = await store.findProfileByUsername(username);
    const storedHash = profile ? await store.recoveryHashFor(profile.profileId) : null;
    // Verify even when there is nothing to verify against, so a username that
    // does not exist costs the same work as a wrong code.
    const matches = await verifyRecoveryCode(body.recoveryCode, storedHash);
    if (!profile || !matches) return fail("invalid_recovery_code", BAD_RECOVERY);
    profileId = profile.profileId;
  } catch (e) {
    console.error("[account] recovery check failed:", e);
    return fail("unknown", "Could not check that recovery code. Please try again.");
  }

  // Order matters, because there is no transaction across these two writes.
  // Password first: if the rotation below then fails, the student is still in
  // (new password works, old code still live). The other order can end with a
  // retired code AND an unchanged password — an account nobody can reach.
  try {
    await store.setPassword(profileId, password);
  } catch (e) {
    console.error("[account] recovery could not set the password:", e);
    return fail("unknown", "Could not reset the password. Please try again.");
  }

  // Replacing the hash is what makes the redeemed code one-time, and it leaves
  // the account with a way back in. On failure the response carries no
  // recoveryCode, which tells the UI to say "keep the code you just used".
  let nextCode: string | undefined = (deps.newRecoveryCode ?? generateRecoveryCode)();
  try {
    await store.putRecoveryHash(profileId, await hashRecoveryCode(nextCode));
  } catch (e) {
    console.error("[account] recovery could not rotate the code:", e);
    nextCode = undefined;
  }

  let session: AccountSession | null = null;
  try {
    const email = await store.loginEmailFor(profileId);
    if (email) session = await store.signIn(email, password);
  } catch (e) {
    console.error("[account] recovery could not open a session:", e);
  }

  return ok(username, session, nextCode);
}

export async function handleAccountRequest(
  req: Request,
  deps: AccountDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return fail("invalid_input", "Method not allowed");
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return fail("invalid_input", "Invalid JSON body");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("invalid_input", "Invalid request body");
  }
  const body = parsed as Record<string, unknown>;

  switch (body.action) {
    case "signup":
      return await handleSignUp(body, deps);
    case "signin":
      return await handleSignIn(body, deps);
    case "recover":
      return await handleRecover(body, deps);
    default:
      return fail("invalid_input", "Unknown action");
  }
}
