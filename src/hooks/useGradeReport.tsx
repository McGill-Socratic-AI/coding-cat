import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import {
  ConsentState,
  GradeItem,
  GradesError,
  GradesRequest,
  GradesResponse,
} from '../types';

type Loaded = {
  consent: ConsentState;
  grades: Partial<Record<GradeItem, number>>;
};

export type GradeReportState =
  | { status: 'loading' }
  | ({ status: 'ready' } & Loaded)
  | { status: 'error'; kind: GradesError['kind']; message: string };

/**
 * Talks to the `submit-grades` Edge Function.
 *
 * Every action returns the server's whole freshly-read view (consent state plus
 * the caller's current answers), so this hook never has to reason about what
 * the server now believes — it just replaces its state with the reply. That
 * also means a failed save cannot leave the form showing values that were
 * never stored.
 */
export default function useGradeReport(enabled: boolean) {
  const [state, setState] = useState<GradeReportState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (body: GradesRequest): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke<GradesResponse>(
      'submit-grades',
      { body },
    );

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
      if (parsed && parsed.ok === false) {
        setState({ status: 'error', kind: parsed.kind, message: parsed.message });
      } else {
        setState({
          status: 'error',
          kind: 'unknown',
          message: 'Could not reach the grade reporting service. ' + error.message,
        });
      }
      console.error(error);
      return false;
    }

    if (!data) {
      setState({
        status: 'error',
        kind: 'unknown',
        message: 'The grade reporting service did not return a response.',
      });
      return false;
    }

    if (data.ok === false) {
      setState({ status: 'error', kind: data.kind, message: data.message });
      return false;
    }

    setState({ status: 'ready', consent: data.consent, grades: data.grades });
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setState({ status: 'loading' });
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

  return { state, busy, grantConsent, withdraw, submit, retry };
}
