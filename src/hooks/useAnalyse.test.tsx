import { act, renderHook, waitFor } from '@testing-library/react';
import useAnalyze from './useAnalyse';
import { supabase } from '../supabaseClient';
import { AnalyzeRequest, Problem } from '../types';

// Regression guard for issue #25: structured backend errors must surface via
// the panel as their actual kind (rate_limit / auth / flag_off / invalid_input)
// instead of collapsing to 'upstream'. supabase-js puts the response body on
// error.context (a Response); the hook must read it.
jest.mock('../supabaseClient', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

const problem: Problem = {
  description: '',
  meta: { name: 'p1', title: '', difficulty: '', author: '', category: '', question_type: ['coding'] },
  io: [],
};

const request: AnalyzeRequest = {
  meta: problem.meta,
  description: '',
  io: [],
  starter: '',
  code: '',
  testReport: [],
};

beforeEach(() => {
  mockInvoke.mockReset();
});

test('rate_limit response body on error.context surfaces as kind:rate_limit with retryAt and usage', async () => {
  const body = {
    ok: false,
    kind: 'rate_limit',
    message: 'Per-problem analysis limit reached for today.',
    retryAt: '2026-05-12T00:00:00Z',
    usage: { dailyUsed: 5, problemUsed: 5 },
  };
  mockInvoke.mockResolvedValue({
    data: null,
    error: { message: '429', context: new Response(JSON.stringify(body), { status: 429 }) },
  } as any);

  const { result } = renderHook(() => useAnalyze(problem));
  await act(async () => { await result.current.run(request); });

  await waitFor(() => expect(result.current.state.status).toBe('error'));
  const s = result.current.state;
  if (s.status !== 'error') throw new Error('unreachable');
  expect(s.kind).toBe('rate_limit');
  expect(s.message).toBe(body.message);
  expect(s.retryAt).toBe(body.retryAt);
  expect(s.usage).toEqual(body.usage);
});

test('error without a parseable context body falls back to kind:upstream', async () => {
  mockInvoke.mockResolvedValue({
    data: null,
    error: { message: 'network down', context: new Response('<html>502</html>', { status: 502 }) },
  } as any);

  const { result } = renderHook(() => useAnalyze(problem));
  await act(async () => { await result.current.run(request); });

  await waitFor(() => expect(result.current.state.status).toBe('error'));
  const s = result.current.state;
  if (s.status !== 'error') throw new Error('unreachable');
  expect(s.kind).toBe('upstream');
});
