// The browser half of pseudonymous accounts: the only module that talks to the
// `account` Edge Function (supabase/functions/account/).
//
// Nothing here goes to GoTrue directly. Signing in needs the account's real
// login address, which is a random placeholder deliberately kept server-side,
// so the function resolves the username itself and hands back the two session
// tokens. `setSession` is therefore the moment the student becomes signed in —
// and it is called separately, on purpose: the sign-up screen has to show the
// recovery code *before* the session lands, because the app redirects away from
// the auth page as soon as it does.

import { supabase } from '../supabaseClient';
import type { AccountError, AccountResponse, AccountSession, AccountSuccess } from '../types';

const GENERIC_FAILURE: AccountError = {
  ok: false,
  kind: 'unknown',
  message: 'Could not reach the accounts service. Please try again.',
};

/**
 * supabase-js reports a non-2xx as `error` and leaves the body on
 * `error.context` (a Response). The function's own structured error lives
 * there, so a 401 surfaces as `invalid_credentials` and not as a network
 * failure. Same shape as `parseInvokeError` in hooks/useAnalyse.tsx.
 */
async function parseInvokeError(error: unknown): Promise<AccountError | null> {
  try {
    if (error && typeof error === 'object' && 'context' in error) {
      const ctx = (error as { context: unknown }).context;
      if (ctx instanceof Response) {
        const parsed = await ctx.clone().json();
        if (parsed && parsed.ok === false) return parsed as AccountError;
      }
    }
  } catch {
    /* fall through to the generic failure */
  }
  return null;
}

async function callAccount(body: Record<string, unknown>): Promise<AccountResponse> {
  const { data, error } = await supabase.functions.invoke<AccountResponse>('account', { body });
  if (error) {
    const parsed = await parseInvokeError(error);
    if (parsed) return parsed;
    console.error(error);
    return GENERIC_FAILURE;
  }
  if (!data) return GENERIC_FAILURE;
  return data;
}

export function signUp(username: string, password: string): Promise<AccountResponse> {
  return callAccount({ action: 'signup', username, password });
}

export function signIn(username: string, password: string): Promise<AccountResponse> {
  return callAccount({ action: 'signin', username, password });
}

export function recoverAccount(
  username: string,
  recoveryCode: string,
  password: string,
): Promise<AccountResponse> {
  return callAccount({ action: 'recover', username, recoveryCode, password });
}

/**
 * Install the session the function handed back. Separate from the calls above
 * so the caller controls *when* the student becomes signed in.
 */
export async function activateSession(session: AccountSession): Promise<string | null> {
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return error ? error.message : null;
}

export function isAccountSuccess(response: AccountResponse): response is AccountSuccess {
  return response.ok;
}
