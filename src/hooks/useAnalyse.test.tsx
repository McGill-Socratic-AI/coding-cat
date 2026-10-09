import { act, renderHook, waitFor } from '@testing-library/react';
import useAnalyze from './useAnalyse';
import { supabase } from '../supabaseClient';
import { AnalyzeRequest, AnalyzeThread, Problem } from '../types';
import { MAX_FOLLOWUP_LEN, MAX_FOLLOWUPS_PER_THREAD } from '../utils/analysisLimits';
import type { Session } from '@supabase/supabase-js';

// Regression guard for issue #25: structured backend errors must surface via
// the panel as their actual kind (rate_limit / auth / flag_off / invalid_input)
// instead of collapsing to 'upstream'. supabase-js puts the response body on
// error.context (a Response); the hook must read it.
//
// The `from` mock serves the conversation re-open path; each test installs the
// rows it wants with `mockTable`.
jest.mock('../supabaseClient', () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;
const mockFrom = supabase.from as unknown as jest.Mock;

// Minimal PostgREST stand-in: chainable, and thenable because the hook awaits
// the .order() chain without a terminal .single()/.maybeSingle().
function mockTable(answers: Record<string, { data: unknown; error: unknown }>) {
  mockFrom.mockImplementation((table: string) => {
    const answer = () => Promise.resolve(answers[table] ?? { data: null, error: null });
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      maybeSingle: () => answer(),
      single: () => answer(),
      then: (ok: any, err: any) => answer().then(ok, err),
    };
    return chain;
  });
}

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

const THREAD_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-10-09T12:00:00.000Z';

function thread(overrides: Partial<AnalyzeThread> = {}): AnalyzeThread {
  return {
    threadId: THREAD_ID,
    messages: [
      { id: '0', role: 'user', source: 'review', content: 'Requested an analysis of my code.', turnIndex: 0, createdAt: NOW },
      { id: '1', role: 'assistant', source: 'review', content: 'What does line 2 do?', turnIndex: 1, createdAt: NOW },
    ],
    followUpsUsed: 0,
    followUpsLimit: MAX_FOLLOWUPS_PER_THREAD,
    ...overrides,
  };
}

function okResponse(over: Partial<{ analysis: string; thread: AnalyzeThread }> = {}) {
  return {
    data: {
      ok: true,
      analysis: over.analysis ?? 'What does line 2 do?',
      usage: { dailyUsed: 1, problemUsed: 1 },
      thread: over.thread ?? thread(),
    },
    error: null,
  } as any;
}

function errorResponse(body: Record<string, unknown>, status: number) {
  return {
    data: null,
    error: { message: String(status), context: new Response(JSON.stringify(body), { status }) },
  } as any;
}

// Runs the first review so a conversation exists to follow up on.
async function withAnalyzedThread(t: AnalyzeThread = thread()) {
  mockInvoke.mockResolvedValueOnce(okResponse({ thread: t }));
  const hook = renderHook(() => useAnalyze(problem));
  await act(async () => { await hook.result.current.run(request); });
  await waitFor(() => expect(hook.result.current.thread).not.toBeNull());
  return hook;
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockFrom.mockReset();
  mockTable({});
});

test('rate_limit response body on error.context surfaces as kind:rate_limit with retryAt and usage', async () => {
  const body = {
    ok: false,
    kind: 'rate_limit',
    message: 'Per-problem analysis limit reached for today.',
    retryAt: '2026-05-12T00:00:00Z',
    usage: { dailyUsed: 5, problemUsed: 5 },
  };
  mockInvoke.mockResolvedValue(errorResponse(body, 429));

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

// --- Multi-turn follow-ups -------------------------------------------------

test('a review exposes the conversation it started', async () => {
  const { result } = await withAnalyzedThread();
  expect(result.current.thread?.threadId).toBe(THREAD_ID);
  expect(result.current.thread?.messages).toHaveLength(2);
  expect(result.current.followUp.status).toBe('idle');
});

test('a follow-up continues the conversation by sending its thread id', async () => {
  const { result } = await withAnalyzedThread();

  const answered = thread({
    messages: [
      ...thread().messages,
      { id: '2', role: 'user', source: 'followup', content: 'why not a dict?', turnIndex: 2, createdAt: NOW },
      { id: '3', role: 'assistant', source: 'followup', content: 'What would a dict let you look up in one step?', turnIndex: 3, createdAt: NOW },
    ],
    followUpsUsed: 1,
  });
  mockInvoke.mockResolvedValueOnce(okResponse({ thread: answered }));

  await act(async () => {
    await result.current.askFollowUp({ ...request, code: 'def f(): pass' }, '  why not a dict?  ');
  });

  // The thread id is how the earlier exchange travels: the backend hands it to
  // the Socratic API, which replays that session's prior turns into the prompt.
  const sent = mockInvoke.mock.calls[1][1] as any;
  expect(sent.body.followUp).toEqual({ threadId: THREAD_ID, message: 'why not a dict?' });
  // ...and the turn still carries the submission as it stands now.
  expect(sent.body.code).toBe('def f(): pass');

  await waitFor(() => expect(result.current.thread?.followUpsUsed).toBe(1));
  expect(result.current.thread?.messages).toHaveLength(4);
  expect(result.current.followUp.status).toBe('idle');
});

test('a follow-up leaves the analysis on screen untouched', async () => {
  const { result } = await withAnalyzedThread();
  mockInvoke.mockResolvedValueOnce(okResponse({ thread: thread({ followUpsUsed: 1 }) }));

  await act(async () => { await result.current.askFollowUp(request, 'and the space complexity?'); });

  const s = result.current.state;
  if (s.status !== 'success') throw new Error('expected the analysis to still be shown');
  expect(s.analysis).toBe('What does line 2 do?');
});

test('the turn cap is refused client-side without calling the service', async () => {
  const { result } = await withAnalyzedThread(
    thread({ followUpsUsed: MAX_FOLLOWUPS_PER_THREAD }),
  );
  mockInvoke.mockClear();

  await act(async () => { await result.current.askFollowUp(request, 'one more?'); });

  expect(mockInvoke).not.toHaveBeenCalled();
  const f = result.current.followUp;
  if (f.status !== 'error') throw new Error('expected the turn cap to block the question');
  expect(f.kind).toBe('turn_limit');
  expect(f.message).toContain(String(MAX_FOLLOWUPS_PER_THREAD));
});

test('a turn_limit from the backend surfaces on the follow-up input', async () => {
  const { result } = await withAnalyzedThread();
  mockInvoke.mockResolvedValueOnce(errorResponse({
    ok: false,
    kind: 'turn_limit',
    message: 'This conversation has reached its limit of 10 follow-up questions.',
  }, 429));

  await act(async () => { await result.current.askFollowUp(request, 'one more?'); });

  await waitFor(() => expect(result.current.followUp.status).toBe('error'));
  const f = result.current.followUp;
  if (f.status !== 'error') throw new Error('unreachable');
  expect(f.kind).toBe('turn_limit');
  // The conversation stays on screen so the student keeps their answers.
  expect(result.current.thread?.threadId).toBe(THREAD_ID);
});

test('a question over the length cap is refused client-side', async () => {
  const { result } = await withAnalyzedThread();
  mockInvoke.mockClear();

  await act(async () => {
    await result.current.askFollowUp(request, 'x'.repeat(MAX_FOLLOWUP_LEN + 1));
  });

  expect(mockInvoke).not.toHaveBeenCalled();
  const f = result.current.followUp;
  if (f.status !== 'error') throw new Error('expected the length cap to block the question');
  expect(f.kind).toBe('invalid_input');
});

test('an empty question is ignored', async () => {
  const { result } = await withAnalyzedThread();
  mockInvoke.mockClear();

  await act(async () => { await result.current.askFollowUp(request, '   '); });

  expect(mockInvoke).not.toHaveBeenCalled();
  expect(result.current.followUp.status).toBe('idle');
});

test('a follow-up before any analysis is refused', async () => {
  const { result } = renderHook(() => useAnalyze(problem));

  await act(async () => { await result.current.askFollowUp(request, 'hello?'); });

  expect(mockInvoke).not.toHaveBeenCalled();
  const f = result.current.followUp;
  if (f.status !== 'error') throw new Error('expected a refusal');
  expect(f.kind).toBe('thread_not_found');
});

test('thread_not_found drops the conversation so the panel offers a fresh analysis', async () => {
  // What the backend returns when the thread is not the caller's (or no longer
  // exists) — the two are deliberately indistinguishable.
  const { result } = await withAnalyzedThread();
  mockInvoke.mockResolvedValueOnce(errorResponse({
    ok: false,
    kind: 'thread_not_found',
    message: 'Conversation not found',
  }, 404));

  await act(async () => { await result.current.askFollowUp(request, 'why?'); });

  await waitFor(() => expect(result.current.thread).toBeNull());
  const f = result.current.followUp;
  if (f.status !== 'error') throw new Error('unreachable');
  expect(f.kind).toBe('thread_not_found');
});

// --- Re-opening a persisted conversation ----------------------------------

test('a signed-in student re-opens their stored conversation', async () => {
  mockTable({
    analyze_threads: { data: { id: THREAD_ID }, error: null },
    analyze_messages: {
      data: [
        { id: 1, role: 'user', source: 'review', content: 'Requested an analysis of my code.', turn_index: 0, created_at: NOW },
        { id: 2, role: 'assistant', source: 'review', content: 'What does line 2 do?', turn_index: 1, created_at: NOW },
        { id: 3, role: 'user', source: 'followup', content: 'why not a dict?', turn_index: 2, created_at: NOW },
        { id: 4, role: 'assistant', source: 'followup', content: 'What would it look up?', turn_index: 3, created_at: NOW },
      ],
      error: null,
    },
  });

  const session = { user: { id: 'u1' } } as unknown as Session;
  const { result } = renderHook(() => useAnalyze(problem, session));

  await waitFor(() => expect(result.current.thread).not.toBeNull());
  expect(result.current.thread?.threadId).toBe(THREAD_ID);
  expect(result.current.thread?.messages).toHaveLength(4);
  expect(result.current.thread?.followUpsUsed).toBe(1);
  expect(mockFrom).toHaveBeenCalledWith('analyze_threads');
  expect(mockFrom).toHaveBeenCalledWith('analyze_messages');
});

test('a signed-out visitor reads no conversation at all', async () => {
  mockTable({ analyze_threads: { data: { id: THREAD_ID }, error: null } });

  const { result } = renderHook(() => useAnalyze(problem, null));
  await act(async () => { await Promise.resolve(); });

  expect(mockFrom).not.toHaveBeenCalled();
  expect(result.current.thread).toBeNull();
});

test('a student with no stored conversation starts empty', async () => {
  mockTable({ analyze_threads: { data: null, error: null } });

  const session = { user: { id: 'u1' } } as unknown as Session;
  const { result } = renderHook(() => useAnalyze(problem, session));
  await act(async () => { await Promise.resolve(); });

  expect(mockFrom).toHaveBeenCalledWith('analyze_threads');
  expect(mockFrom).not.toHaveBeenCalledWith('analyze_messages');
  expect(result.current.thread).toBeNull();
});
