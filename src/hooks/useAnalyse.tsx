import { supabase } from '../supabaseClient';
import { useState } from 'react';
import { AnalyzeError, Usage, AnalyzeRequest, AnalyzeResponse } from '../types';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; analysis: string; usage: Usage }
  | { status: 'error'; kind: AnalyzeError['kind']; message: string; retryAt?: string; usage?: Usage };

export default function useAnalyze() {
  const [state, setState] = useState<State>({ status: 'idle' });
  async function run(body: AnalyzeRequest) {
    setState({ status: 'loading' });
    if (process.env.REACT_APP_USE_MOCK_ANALYZE === 'true') {
      await new Promise(r => setTimeout(r, 800));
      // console.log(body.testReport); console.log(JSON.stringify(body.testReport)); 
      setState({ status: 'success', analysis: `
...mock markdown...
        
- List 1 **bold** *italic*

\`some code \` 

* list 2`,
        
      usage: { dailyUsed: 1, problemUsed: 1 } });
      if (Math.random() < 0.5) {
        setState({status: 'error', kind:'unknown', message:'some message.', retryAt: '01:01', usage:{dailyUsed: 1, problemUsed: 1}});
      }
      return;
    }
    const { data, error } = await supabase.functions.invoke<AnalyzeResponse>('analyze', { body });
    if (error) {
      // supabase-js returns non-2xx in `error` with the response body on `error.context: Response`.
      // Try to surface the backend's structured AnalyzeError; fall back to 'upstream' if the
      // body is missing or shape is unexpected.
      let parsed: AnalyzeResponse | null = null;
      try {
        if ('context' in error && error.context instanceof Response) {
          parsed = await error.context.clone().json();
        }
      } catch { /* fall through to upstream */ }
      if (parsed && parsed.ok === false) {
        setState({status:'error', kind: parsed.kind, message: parsed.message, retryAt: parsed.retryAt, usage: parsed.usage});
      } else {
        setState({status:'error', kind:'upstream', message:'The analysis service did not return a response... ' + error.message});
      }
      console.error(error);
      return;
    }
    if (data) {
      data.ok ? setState({status: 'success', analysis: data.analysis, usage: data.usage}) : setState({status: 'error', kind: data.kind, message: data.message, retryAt: data.retryAt, usage: data.usage});
    }
    else setState({status:'error', kind:'upstream', message:'The analysis service did not return a response.'})
    
  }
  return { state, run };
}
