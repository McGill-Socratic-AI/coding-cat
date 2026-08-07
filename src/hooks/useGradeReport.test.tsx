import { act, renderHook, waitFor } from '@testing-library/react';
import useGradeReport from './useGradeReport';
import { supabase } from '../supabaseClient';
import { ConsentState, GradeItem } from '../types';

jest.mock('../supabaseClient', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

const consent: ConsentState = {
  version: '2026-08-comp204-v1',
  text: 'Consent text.',
  granted: false,
  grantedAt: null,
};

const granted: ConsentState = { ...consent, granted: true, grantedAt: '2026-08-01T00:00:00Z' };

function okResponse(
  overrides: Partial<{
    consent: ConsentState;
    grades: Partial<Record<GradeItem, number>>;
  }> = {},
) {
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

  await waitFor(() => expect(result.current.state.phase).toBe('ready'));
  expect(mockInvoke).toHaveBeenCalledWith('submit-grades', { body: { action: 'status' } });
  expect(result.current.state.data?.grades).toEqual({ exam_1: 88 });
  expect(result.current.state.data?.consent.version).toBe('2026-08-comp204-v1');
  expect(result.current.state.error).toBeNull();
});

test('does not call the function when disabled', async () => {
  renderHook(() => useGradeReport(false));
  await new Promise((r) => setTimeout(r, 0));
  expect(mockInvoke).not.toHaveBeenCalled();
});

test('a dark feature flag on first load surfaces as kind:flag_off with no data', async () => {
  mockInvoke.mockResolvedValue(errorResponse('flag_off', 'Grade reporting is currently disabled', 403));

  const { result } = renderHook(() => useGradeReport(true));

  await waitFor(() => expect(result.current.state.phase).toBe('error'));
  expect(result.current.state.error?.kind).toBe('flag_off');
  expect(result.current.state.data).toBeNull();
});

test('consent_required surfaces with its own kind rather than collapsing to unknown', async () => {
  mockInvoke.mockResolvedValue(
    errorResponse('consent_required', 'Please read and accept the research consent form first', 403),
  );

  const { result } = renderHook(() => useGradeReport(true));

  await waitFor(() => expect(result.current.state.phase).toBe('error'));
  expect(result.current.state.error?.kind).toBe('consent_required');
});

test('an unparseable error body falls back to kind:unknown', async () => {
  mockInvoke.mockResolvedValue({
    data: null,
    error: { message: 'gateway', context: new Response('<html>502</html>', { status: 502 }) },
  } as any);

  const { result } = renderHook(() => useGradeReport(true));

  await waitFor(() => expect(result.current.state.phase).toBe('error'));
  expect(result.current.state.error?.kind).toBe('unknown');
});

test('granting consent echoes the version the server offered', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse());
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.phase).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted }));
  await act(async () => {
    await result.current.grantConsent('2026-08-comp204-v1');
  });

  expect(mockInvoke).toHaveBeenLastCalledWith('submit-grades', {
    body: { action: 'consent', consentVersion: '2026-08-comp204-v1' },
  });
  expect(result.current.state.data?.consent.granted).toBe(true);
});

test('submit sends only the values it was given and adopts the server reply', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted, grades: { exam_1: 50 } }));
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.phase).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted, grades: { exam_1: 91 } }));
  await act(async () => {
    await result.current.submit({ exam_1: 91, exam_2: null });
  });

  expect(mockInvoke).toHaveBeenLastCalledWith('submit-grades', {
    body: { action: 'submit', grades: { exam_1: 91, exam_2: null } },
  });
  // State comes from the server's reply, not from what we optimistically sent.
  expect(result.current.state.data?.grades).toEqual({ exam_1: 91 });
});

test('a failed action keeps the last good data instead of erasing it', async () => {
  // The regression this pins: a single tagged union meant any failure replaced
  // the whole state, and the UI rendered nothing for flag_off/auth — so a
  // failed save wiped the form and everything the student had typed.
  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted, grades: { exam_1: 50 } }));
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.phase).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(errorResponse('rate_limit', 'Too many changes today.', 429));
  let ok: boolean | undefined;
  await act(async () => {
    ok = await result.current.submit({ exam_1: 91 });
  });

  expect(ok).toBe(false);
  expect(result.current.state.phase).toBe('ready');
  expect(result.current.state.data?.grades).toEqual({ exam_1: 50 });
  expect(result.current.state.error?.kind).toBe('rate_limit');
});

test('even flag_off after a successful load keeps the data on screen', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted, grades: { exam_1: 50 } }));
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.phase).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(errorResponse('flag_off', 'disabled', 403));
  await act(async () => {
    await result.current.submit({ exam_1: 91 });
  });

  expect(result.current.state.phase).toBe('ready');
  expect(result.current.state.data?.grades).toEqual({ exam_1: 50 });
});

test('dismissError clears the banner without touching the data', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted, grades: { exam_1: 50 } }));
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.phase).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(errorResponse('unknown', 'boom', 500));
  await act(async () => {
    await result.current.submit({ exam_1: 91 });
  });
  expect(result.current.state.error).not.toBeNull();

  act(() => {
    result.current.dismissError();
  });
  expect(result.current.state.error).toBeNull();
  expect(result.current.state.data?.grades).toEqual({ exam_1: 50 });
});

test('a successful action clears a previous error', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted }));
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.phase).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(errorResponse('unknown', 'boom', 500));
  await act(async () => {
    await result.current.submit({ exam_1: 91 });
  });
  expect(result.current.state.error).not.toBeNull();

  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted, grades: { exam_1: 91 } }));
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.state.error).toBeNull();
  expect(result.current.state.data?.grades).toEqual({ exam_1: 91 });
});

test('withdraw asks the server to delete and adopts the emptied reply', async () => {
  mockInvoke.mockResolvedValueOnce(okResponse({ consent: granted, grades: { exam_1: 70 } }));
  const { result } = renderHook(() => useGradeReport(true));
  await waitFor(() => expect(result.current.state.phase).toBe('ready'));

  mockInvoke.mockResolvedValueOnce(okResponse({ consent, grades: {} }));
  await act(async () => {
    await result.current.withdraw();
  });

  expect(mockInvoke).toHaveBeenLastCalledWith('submit-grades', { body: { action: 'withdraw' } });
  expect(result.current.state.data?.consent.granted).toBe(false);
  expect(result.current.state.data?.grades).toEqual({});
});
