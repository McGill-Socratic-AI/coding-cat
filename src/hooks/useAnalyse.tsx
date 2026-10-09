import { supabase } from '../supabaseClient';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  AnalyzeError,
  AnalyzeRequest,
  AnalyzeResponse,
  AnalyzeThread,
  Problem,
  ThreadMessage,
  Usage,
} from '../types';
import { MAX_FOLLOWUP_LEN, MAX_FOLLOWUPS_PER_THREAD } from '../utils/analysisLimits';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; analysis: string; usage: Usage }
  | { status: 'error'; kind: AnalyzeError['kind']; message: string; retryAt?: string; usage?: Usage };

// The follow-up input's own state machine. Kept separate from `state` so a
// failed follow-up never wipes the analysis the student is reading.
export type FollowUpState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; kind: AnalyzeError['kind']; message: string; retryAt?: string };

const MOCK = () => process.env.REACT_APP_USE_MOCK_ANALYZE === 'true';

// supabase-js returns non-2xx in `error` with the response body on
// `error.context: Response`. Surface the backend's structured AnalyzeError;
// callers fall back to 'upstream' when the body is missing or unexpected.
async function parseInvokeError(error: unknown): Promise<AnalyzeError | null> {
  try {
    if (error && typeof error === 'object' && 'context' in error) {
      const ctx = (error as { context: unknown }).context;
      if (ctx instanceof Response) {
        const parsed = await ctx.clone().json();
        if (parsed && parsed.ok === false) return parsed as AnalyzeError;
      }
    }
  } catch { /* fall through to upstream */ }
  return null;
}

function mockThread(threadId: string, messages: ThreadMessage[]): AnalyzeThread {
  return {
    threadId,
    messages,
    followUpsUsed: messages.filter(m => m.role === 'user' && m.source === 'followup').length,
    followUpsLimit: MAX_FOLLOWUPS_PER_THREAD,
  };
}

export default function useAnalyze(problem: Problem, session?: Session | null) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [thread, setThread] = useState<AnalyzeThread | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpState>({ status: 'idle' });

  // Read inside async callbacks so a follow-up always targets the thread the
  // latest response described, without re-creating the callback each render.
  const threadRef = useRef<AnalyzeThread | null>(null);
  threadRef.current = thread;

  const problemName = problem.meta.name;
  // Depend on the id, not the Session object: a context that hands back a new
  // object each render would otherwise re-fetch the conversation every render.
  const userId = session?.user?.id;

  // Reset state when the user switches problems so a previous problem's
  // success/error result doesn't leak into the new problem's panel.
  useEffect(() => {
    setState({ status: 'idle' });
    setThread(null);
    setFollowUp({ status: 'idle' });
  }, [problemName]);

  // Re-open a persisted conversation. Reads run under the student's own JWT, so
  // RLS (analyze_threads_self_select / analyze_messages_self_select) is what
  // scopes this to their own thread. Signed-out users never get here.
  useEffect(() => {
    if (!userId || MOCK()) return;
    let cancelled = false;

    (async () => {
      const { data: threadRow, error: threadError } = await supabase
        .from('analyze_threads')
        .select('id')
        .eq('problem_name', problemName)
        .maybeSingle();
      if (cancelled) return;
      if (threadError) {
        console.warn('Could not load AI analysis conversation:', threadError.message);
        return;
      }
      if (!threadRow) return;

      const { data: rows, error: messageError } = await supabase
        .from('analyze_messages')
        .select('id, role, source, content, turn_index, created_at')
        .eq('thread_id', threadRow.id)
        .order('turn_index', { ascending: true });
      if (cancelled) return;
      if (messageError) {
        console.warn('Could not load AI analysis messages:', messageError.message);
        return;
      }

      const messages: ThreadMessage[] = (rows ?? []).map((r: any) => ({
        id: String(r.id),
        role: r.role,
        source: r.source,
        content: r.content,
        turnIndex: r.turn_index,
        createdAt: r.created_at,
      }));
      // `prev ?? loaded`: a review or follow-up that landed while this read was
      // in flight already holds the newer conversation — don't clobber it.
      setThread(prev => prev ?? {
        threadId: threadRow.id,
        messages,
        followUpsUsed: messages.filter(m => m.role === 'user' && m.source === 'followup').length,
        followUpsLimit: MAX_FOLLOWUPS_PER_THREAD,
      });
    })();

    return () => { cancelled = true; };
  }, [problemName, userId]);

  async function run(body: AnalyzeRequest) {
    setState({ status: 'loading' });
    setFollowUp({ status: 'idle' });
    if (MOCK()) {
      await new Promise(r => setTimeout(r, 800));
      const analysis = `
...mock markdown...

- List 1 **bold** *italic*

\`some code \`

* list 2`;
      setState({ status: 'success', analysis, usage: { dailyUsed: 1, problemUsed: 1 } });
      setThread(mockThread('mock-thread', [
        { id: 'm0', role: 'user', source: 'review', content: 'Requested an analysis of my code.', turnIndex: 0, createdAt: new Date().toISOString() },
        { id: 'm1', role: 'assistant', source: 'review', content: analysis, turnIndex: 1, createdAt: new Date().toISOString() },
      ]));
      if (Math.random() < 0.5) {
        setState({status: 'error', kind:'unknown', message:'some message.', retryAt: '01:01', usage:{dailyUsed: 1, problemUsed: 1}});
      }
      return;
    }
    const { data, error } = await supabase.functions.invoke<AnalyzeResponse>('analyze', { body });
    if (error) {
      const parsed = await parseInvokeError(error);
      if (parsed) {
        setState({status:'error', kind: parsed.kind, message: parsed.message, retryAt: parsed.retryAt, usage: parsed.usage});
      } else {
        setState({status:'error', kind:'upstream', message:'The analysis service did not return a response... ' + error.message});
      }
      console.error(error);
      return;
    }
    if (data) {
      if (data.ok) {
        setState({status: 'success', analysis: data.analysis, usage: data.usage});
        if (data.thread) setThread(data.thread);
      } else {
        setState({status: 'error', kind: data.kind, message: data.message, retryAt: data.retryAt, usage: data.usage});
      }
    }
    else setState({status:'error', kind:'upstream', message:'The analysis service did not return a response.'})

  }

  // Ask a follow-up question about the same submission. `body` carries the
  // student's current code and test results so the tutor reacts to what is on
  // screen now; the earlier exchange travels with the thread id, server-side.
  const askFollowUp = useCallback(async (body: AnalyzeRequest, message: string) => {
    const current = threadRef.current;
    const trimmed = message.trim();
    if (!current) {
      setFollowUp({ status: 'error', kind: 'thread_not_found', message: 'Generate an analysis before asking a follow-up question.' });
      return;
    }
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_FOLLOWUP_LEN) {
      setFollowUp({ status: 'error', kind: 'invalid_input', message: `Keep your question under ${MAX_FOLLOWUP_LEN} characters.` });
      return;
    }
    if (current.followUpsUsed >= current.followUpsLimit) {
      setFollowUp({ status: 'error', kind: 'turn_limit', message: `This conversation has reached its limit of ${current.followUpsLimit} follow-up questions. Generate a new analysis to start fresh.` });
      return;
    }

    setFollowUp({ status: 'loading' });

    if (MOCK()) {
      await new Promise(r => setTimeout(r, 500));
      const next = current.messages.length;
      setThread(mockThread(current.threadId, [
        ...current.messages,
        { id: `m${next}`, role: 'user', source: 'followup', content: trimmed, turnIndex: next, createdAt: new Date().toISOString() },
        { id: `m${next + 1}`, role: 'assistant', source: 'followup', content: `Mock follow-up reply to: *${trimmed}*`, turnIndex: next + 1, createdAt: new Date().toISOString() },
      ]));
      setFollowUp({ status: 'idle' });
      return;
    }

    const { data, error } = await supabase.functions.invoke<AnalyzeResponse>('analyze', {
      body: { ...body, followUp: { threadId: current.threadId, message: trimmed } },
    });

    if (error) {
      const parsed = await parseInvokeError(error);
      if (parsed) {
        setFollowUp({ status: 'error', kind: parsed.kind, message: parsed.message, retryAt: parsed.retryAt });
        // The conversation is gone server-side — drop it so the panel offers a
        // fresh analysis instead of retrying against a dead thread id.
        if (parsed.kind === 'thread_not_found') setThread(null);
      } else {
        setFollowUp({ status: 'error', kind: 'upstream', message: 'The analysis service did not return a response... ' + error.message });
      }
      console.error(error);
      return;
    }
    if (!data) {
      setFollowUp({ status: 'error', kind: 'upstream', message: 'The analysis service did not return a response.' });
      return;
    }
    if (!data.ok) {
      setFollowUp({ status: 'error', kind: data.kind, message: data.message, retryAt: data.retryAt });
      if (data.kind === 'thread_not_found') setThread(null);
      return;
    }
    if (data.thread) setThread(data.thread);
    if (data.usage) setState(prev => (prev.status === 'success' ? { ...prev, usage: data.usage } : prev));
    setFollowUp({ status: 'idle' });
  }, []);

  return { state, run, thread, followUp, askFollowUp };
}
