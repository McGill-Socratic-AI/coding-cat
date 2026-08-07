import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import {
  ConsentState,
  GradeItem,
  GradesError,
  GradesRequest,
  GradesResponse,
} from '../types';

export type Loaded = {
  consent: ConsentState;
  grades: Partial<Record<GradeItem, number>>;
};

export type GradeReportState = {
  phase: 'loading' | 'ready' | 'error';
  /**
   * The last view the server confirmed, kept across a subsequent failure.
   *
   * An earlier version modelled this as a single tagged union, so any failed
   * action replaced the whole state with an error — and the UI, which rendered
   * nothing at all for `flag_off` and `auth`, erased the form and whatever the
   * student had typed into it. Errors are now additive: the last good data
   * stays put and the error is reported alongside it.
   */
  data: Loaded | null;
  error: { kind: GradesError['kind']; message: string } | null;
};

/**
 * Talks to the `submit-grades` Edge Function.
 *
 * Every action returns the server's whole freshly-read view (consent state plus
 * the caller's current answers), so this hook never has to reason about what the
 * server now believes — it replaces `data` with the reply. That also means a
 * failed save cannot leave the form showing values that were never stored.
 */
export default function useGradeReport(enabled: boolean) {
  const [state, setState] = useState<GradeReportState>({
    phase: 'loading',
    data: null,
    error: null,
  });
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (body: GradesRequest): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke<GradesResponse>(
      'submit-grades',
      { body },
    );

    const fail = (kind: GradesError['kind'], message: string) => {
      setState((prev) => ({
        // Keep whatever we last knew; only a failure with nothing loaded is a
        // dead end.
        phase: prev.data ? 'ready' : 'error',
        data: prev.data,
        error: { kind, message },
      }));
      return false;
    };

    if (error) {
      // supabase-js reports non-2xx through `error`, with the response body on
      // `error.context`. Surface the function's structured error where we can.
      let parsed: GradesResponse | null = null;
      try {
        if ('context' in error && error.context instanceof Response) {
          parsed = await error.context.clone().json();
        }
      } catch {
        /* fall through to the generic message below */
      }
      console.error(error);
      if (parsed && parsed.ok === false) return fail(parsed.kind, parsed.message);
      return fail(
        'unknown',
        'Could not reach the grade reporting service. ' + error.message,
      );
    }

    if (!data) {
      return fail('unknown', 'The grade reporting service did not return a response.');
    }
    if (data.ok === false) return fail(data.kind, data.message);

    setState({
      phase: 'ready',
      data: { consent: data.consent, grades: data.grades },
      error: null,
    });
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await call({ action: 'status' });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, call]);

  const withBusy = useCallback(
    async (body: GradesRequest) => {
      setBusy(true);
      try {
        return await call(body);
      } finally {
        setBusy(false);
      }
    },
    [call],
  );

  const grantConsent = useCallback(
    (consentVersion: string) => withBusy({ action: 'consent', consentVersion }),
    [withBusy],
  );

  const withdraw = useCallback(() => withBusy({ action: 'withdraw' }), [withBusy]);

  const submit = useCallback(
    (grades: Partial<Record<GradeItem, number | null>>) =>
      withBusy({ action: 'submit', grades }),
    [withBusy],
  );

  const retry = useCallback(() => withBusy({ action: 'status' }), [withBusy]);

  const dismissError = useCallback(
    () => setState((prev) => ({ ...prev, error: null })),
    [],
  );

  return { state, busy, grantConsent, withdraw, submit, retry, dismissError };
}
