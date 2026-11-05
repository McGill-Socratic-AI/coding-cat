// Wire types for the `account` Edge Function.
//
// IMPORTANT: mirrored in src/types.ts (the `Account*` block). CRA and Deno
// cannot share a file — see the header of supabase/functions/analyze/types.ts
// for the same arrangement. This copy is the contract; keep both sides in sync.
//
// Note what is NOT in any response: no email address (not even the random
// placeholder), no user object, nothing but the pseudonymous username, the two
// session tokens and — once, at the moment it is issued — the recovery code.

export type AccountErrorKind =
  // The request itself is malformed, or fails the username / password policy.
  | "invalid_input"
  // Somebody already has that username.
  | "username_taken"
  // Wrong username or wrong password; deliberately not distinguished.
  | "invalid_credentials"
  // Wrong username or wrong recovery code; deliberately not distinguished.
  | "invalid_recovery_code"
  | "unknown";

/** Exactly the two tokens `supabase.auth.setSession` needs. */
export type AccountSession = {
  access_token: string;
  refresh_token: string;
};

export type AccountSuccess = {
  ok: true;
  username: string;
  // Present on signup, and on a successful recovery (the redeemed code is
  // replaced by this one, so an account is never left without a way back).
  // Shown to the student once and never retrievable again.
  //
  // Absent from a `recover` response in one case: the password was reset but
  // the replacement code could not be stored. The code just redeemed is then
  // still the live one, and the UI says so.
  recoveryCode?: string;
  // null when the account exists but could not be signed in as part of the same
  // call; the student can simply sign in on the next screen.
  session: AccountSession | null;
};

export type AccountError = {
  ok: false;
  kind: AccountErrorKind;
  message: string;
};

export type AccountResponse = AccountSuccess | AccountError;
