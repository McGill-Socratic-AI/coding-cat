// Everything the account handlers need from Supabase, behind one interface.
//
// The handlers hold the policy (what counts as a valid username, when a code is
// accepted, what order things happen in) and the store holds the I/O, so the
// handler tests can drive the whole flow against an in-memory store instead of
// a live Supabase project — the same reason the analyze function keeps its
// Socratic call in one module.
//
// Both halves need the service-role key:
//   * `auth.admin` creates users and sets passwords without an email round trip
//     (there is no deliverable address to confirm);
//   * `account_recovery` has RLS on and no policies at all, so only the
//     service role can read or write a recovery hash;
//   * resolving a username to its auth user must not be something the browser
//     can do, so it happens here and the placeholder address never leaves.

import { createClient, SupabaseClient } from "supabase";

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`username already taken: ${username}`);
    this.name = "UsernameTakenError";
  }
}

export interface AccountStore {
  /** The profile behind a (normalized) username, or null if there is none. */
  findProfileByUsername(username: string): Promise<{ profileId: string } | null>;
  /** The account's placeholder login address — never returned to a caller. */
  loginEmailFor(profileId: string): Promise<string | null>;
  /**
   * Create the auth user and claim the username in one step.
   * Throws {@link UsernameTakenError} when the handle is gone.
   */
  createUser(args: {
    email: string;
    password: string;
    username: string;
  }): Promise<{ profileId: string }>;
  /** Undo a createUser whose follow-up writes failed. */
  deleteUser(profileId: string): Promise<void>;
  /** Insert or replace the account's recovery hash. */
  putRecoveryHash(profileId: string, hash: string): Promise<void>;
  recoveryHashFor(profileId: string): Promise<string | null>;
  setPassword(profileId: string, password: string): Promise<void>;
  /** Tokens on success, null when the credentials do not match. */
  signIn(
    email: string,
    password: string,
  ): Promise<{ access_token: string; refresh_token: string } | null>;
}

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Sign-in has to go through an anon-key client: the service role bypasses
// GoTrue's password grant entirely, and we want a real user session back.
function anonClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// The username unique index is what actually arbitrates a race between two
// simultaneous signups; it surfaces through GoTrue as an opaque 500 whose
// message carries the Postgres unique-violation text.
function looksLikeUsernameConflict(message: string): boolean {
  const m = message.toLowerCase();
  // Only the unique index: a `profiles_username_policy` CHECK violation would
  // mean the server accepted something validateUsername should have refused,
  // which is a bug to surface, not a username to report as taken.
  return m.includes("profiles_username_key") ||
    (m.includes("duplicate key") && m.includes("username")) ||
    m.includes("23505");
}

export function makeSupabaseStore(): AccountStore {
  const service = serviceClient();

  return {
    async findProfileByUsername(username) {
      const { data, error } = await service
        .from("profiles")
        .select("profile_id")
        // Usernames are stored already normalized, so an equality match is
        // both correct and safe — `ilike` would treat '_' as a wildcard.
        .eq("username", username)
        .maybeSingle();
      if (error) throw new Error(`profiles lookup failed: ${error.message}`);
      return data ? { profileId: data.profile_id as string } : null;
    },

    async loginEmailFor(profileId) {
      const { data, error } = await service.auth.admin.getUserById(profileId);
      if (error) throw new Error(`auth user lookup failed: ${error.message}`);
      return data?.user?.email ?? null;
    },

    async createUser({ email, password, username }) {
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        // There is no mailbox to confirm; without this the user would be stuck
        // waiting for a message that can never arrive.
        email_confirm: true,
        // Read once, by the on_auth_user_created trigger, inside this insert's
        // own transaction — which is what makes "create user" and "claim
        // username" atomic. See the migration for why that matters.
        user_metadata: { username },
      });
      if (error) {
        if (looksLikeUsernameConflict(error.message)) {
          throw new UsernameTakenError(username);
        }
        throw new Error(`createUser failed: ${error.message}`);
      }
      const id = data?.user?.id;
      if (!id) throw new Error("createUser returned no user");
      return { profileId: id };
    },

    async deleteUser(profileId) {
      const { error } = await service.auth.admin.deleteUser(profileId);
      if (error) throw new Error(`deleteUser failed: ${error.message}`);
    },

    async putRecoveryHash(profileId, hash) {
      const { error } = await service
        .from("account_recovery")
        .upsert(
          {
            profile_id: profileId,
            recovery_code_hash: hash,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "profile_id" },
        );
      if (error) throw new Error(`account_recovery write failed: ${error.message}`);
    },

    async recoveryHashFor(profileId) {
      const { data, error } = await service
        .from("account_recovery")
        .select("recovery_code_hash")
        .eq("profile_id", profileId)
        .maybeSingle();
      if (error) throw new Error(`account_recovery read failed: ${error.message}`);
      return (data?.recovery_code_hash as string | undefined) ?? null;
    },

    async setPassword(profileId, password) {
      const { error } = await service.auth.admin.updateUserById(profileId, {
        password,
      });
      if (error) throw new Error(`password update failed: ${error.message}`);
    },

    async signIn(email, password) {
      const { data, error } = await anonClient().auth.signInWithPassword({
        email,
        password,
      });
      // Wrong password is the expected case here, not an outage: report it as
      // "no session" and let the handler turn it into invalid_credentials.
      if (error || !data?.session) return null;
      return {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      };
    },
  };
}
