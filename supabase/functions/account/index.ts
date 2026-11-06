// `account` — registration, sign-in and recovery for pseudonymous accounts.
//
// Runs with verify_jwt = false (see supabase/config.toml): every one of its
// actions is something a signed-out visitor does. It is nonetheless the only
// unauthenticated surface the app has, so it accepts nothing but the three
// actions in handlers.ts and holds no privileged input of its own.
//
// Why the browser does not talk to GoTrue directly, as it did for magic links:
// an account's real login address is a random placeholder that must never be
// shown or guessable from the username, so resolving a username to its auth
// user has to happen server-side, with the service-role key. That also keeps
// the recovery-code hash out of reach of any client.

import { handleOptions } from "./cors.ts";
import { handleAccountRequest } from "./handlers.ts";
import { makeSupabaseStore } from "./store.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return handleOptions(req);
  return await handleAccountRequest(req, { store: makeSupabaseStore() });
});
