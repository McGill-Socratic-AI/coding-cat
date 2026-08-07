import { act, renderHook, waitFor } from '@testing-library/react';
import useGradeReport from './useGradeReport';
import { supabase } from '../supabaseClient';

jest.mock('../supabaseClient', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

const consent = {
  version: '2026-08-comp204-v1',
  text: 'Consent text.',
  granted: false,
  grantedAt: null,
};

function okResponse(overrides: Partial<{ consent: typeof consent; grades: object }> = {}) {
  return {
    data: { ok: true, consent, grades: {}, ...overrides },
    error: null,
  } as any;
}

function errorResponse(kind: string, message: string, status: number) {
  return {
    data: null,
    error: {
      message: String(status),
      context: new Response(JSON.stringify({ ok: false, kind, message }), { status }),
    },
  } as any;
}

beforeEach(() => {
  mockInvoke.mockReset();
});

test('loads the current status on mount', async () => {
  mockInvoke.mockResolvedValue(okResponse({ grades: { exam_1: 88 } }));

  const { result } = renderHook(() => useGradeReport(true));

  await waitFor(() => expect(result.current.state.status).toBe('ready'));
  expect(mockInvoke).toHaveBeenCalledWith('submit-grades', { body: { action: 'status' } });

  const s = result.current.state;
  if (s.status !== 'ready') throw new Error('unreachable');
  expect(s.grades).toEqual({ exam_1: 88 });
  expect(s.consent.version).toBe('2026-08-comp204-v1');
});

test('does not call the function when disabled', async () => {
  renderHook(() => useGradeReport(false));
  await new Promise((r) => setTimeout(r, 0));
  expect(mockInvoke).not.toHaveBeenCalled();
});

test('a dark feature flag surfaces as kind:flag_off so the UI can hide itself', async () => {
  mockInvoke.mockResolvedValue(errorResponse('flag_off', 'Grade reporting is currently disabled', 403));

  const { result } = renderHook(() => useGradeReport(true));

  await waitFor(() => expect(result.current.state.status).toBe('error'));
  const s = result.current.state;
  if (s.status !== 'error') throw new Error('unreachable');
  expect(s.kind).toBe('flag_off');
});

test('consent_required surfaces with its own kind rather than collapsing to unknown', async () => {
  mockInvoke.mockResolvedValue(
    errorResponse('consent_required', 'Please read and accept the research consent form first', 403),
  );

  const { result } = renderHook(() => useGradeReport(true));

  await waitFor(() => expect(result.current.state.status).toBe('error'));
  const s = result.current.state;
  if (s.status !== 'error') throw new Error('unreachable');
  expect(s.kind).toBe('consent_required');
});

test('an unparseable error body falls back to kind:unknown', async () => {
  mockInvoke.mockResolvedValue({
    data: null,
    error: { message: 'gateway', context: new Response('<html>502</html>', { status: 502 }) },
  } as any);

  const { result } = renderHook(() => useGradeReport(true));

  await waitFor(() => expect(result.current.state.status).toBe('error'));
  const s = result.current.state;
  if (s.status !== 'error') throw new Error('unreachable');
  expect(s.kind).toBe('unknown');
});

test('granting consent echoes the version the server offered', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse());
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.status).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(
    okResponse({ consent: { ...consent, granted: true, grantedAt: '2026-08-01T00:00:00Z' } }),
  );
  await act(async () => {
    await result.current.grantConsent('2026-08-comp204-v1');
  });

  expect(mockInvoke).toHaveBeenLastCalledWith('submit-grades', {
    body: { action: 'consent', consentVersion: '2026-08-comp204-v1' },
  });
  const s = result.current.state;
  if (s.status !== 'ready') throw new Error('unreachable');
  expect(s.consent.granted).toBe(true);
});

test('submit sends only the values it was given and adopts the server reply', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse({ grades: { exam_1: 50 } }));
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.status).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(okResponse({ grades: { exam_1: 91 } }));
  await act(async () => {
    await result.current.submit({ exam_1: 91, exam_2: null });
  });

  expect(mockInvoke).toHaveBeenLastCalledWith('submit-grades', {
    body: { action: 'submit', grades: { exam_1: 91, exam_2: null } },
  });
  const s = result.current.state;
  if (s.status !== 'ready') throw new Error('unreachable');
  // State comes from the server's reply, not from what we optimistically sent.
  expect(s.grades).toEqual({ exam_1: 91 });
});

test('a failed submit reports false and leaves an error state', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse());
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.status).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(errorResponse('rate_limit', 'Too many changes today.', 429));
  let ok: boolean | undefined;
  await act(async () => {
    ok = await result.current.submit({ exam_1: 91 });
  });

  expect(ok).toBe(false);
  const s = result.current.state;
  if (s.status !== 'error') throw new Error('unreachable');
  expect(s.kind).toBe('rate_limit');
});

test('withdraw asks the server to delete and adopts the emptied reply', async () => {
  mockInvoke.mockResolvedValueOnce(
    okResponse({ consent: { ...consent, granted: true }, grades: { exam_1: 70 } }),
  );
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.status).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(okResponse({ consent, grades: {} }));
  await act(async () => {
    await result.current.withdraw();
  });

  expect(mockInvoke).toHaveBeenLastCalledWith('submit-grades', { body: { action: 'withdraw' } });
  const s = result.current.state;
  if (s.status !== 'ready') throw new Error('unreachable');
  expect(s.consent.granted).toBe(false);
  expect(s.grades).toEqual({});
});
