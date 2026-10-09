import { render, screen } from '@testing-library/react';
import AnalysisPanel from './AnalysisPanel';
import type { AnalyzeThread, ThreadMessage } from '../types';
import { MAX_FOLLOWUPS_PER_THREAD } from '../utils/analysisLimits';

const NOW = '2026-10-09T12:00:00.000Z';

function turn(turnIndex: number, role: ThreadMessage['role'], source: ThreadMessage['source'], content: string): ThreadMessage {
  return { id: String(turnIndex), role, source, content, turnIndex, createdAt: NOW };
}

// Yesterday's review and its follow-up, then today's review and one follow-up.
const thread: AnalyzeThread = {
  threadId: '33333333-3333-4333-8333-333333333333',
  messages: [
    turn(0, 'user', 'review', 'first review request'),
    turn(1, 'assistant', 'review', 'first review reply'),
    turn(2, 'user', 'followup', 'old question'),
    turn(3, 'assistant', 'followup', 'old answer'),
    turn(4, 'user', 'review', 'second review request'),
    turn(5, 'assistant', 'review', 'second review reply'),
    turn(6, 'user', 'followup', 'new question'),
    turn(7, 'assistant', 'followup', 'new answer'),
  ],
  followUpsUsed: 1,
  followUpsLimit: MAX_FOLLOWUPS_PER_THREAD,
};

beforeEach(() => localStorage.setItem('aiAnalysisAck', 'true'));
afterEach(() => localStorage.clear());

test('under a fresh review only the follow-ups asked since that review are listed', () => {
  render(<AnalysisPanel
    state={{ status: 'success', analysis: 'second review reply', usage: { dailyUsed: 2, problemUsed: 2 } }}
    onAnalyze={() => {}}
    thread={thread}
    followUp={{ status: 'idle' }}
    onFollowUp={() => {}}
  />);
  expect(screen.getByText('new question')).not.toBeNull();
  expect(screen.getByText('new answer')).not.toBeNull();
  expect(screen.queryByText('old question')).toBeNull();
  expect(screen.queryByText('old answer')).toBeNull();
});

test('a re-opened conversation shows the latest review and its follow-ups only', () => {
  render(<AnalysisPanel
    state={{ status: 'idle' }}
    onAnalyze={() => {}}
    thread={thread}
    followUp={{ status: 'idle' }}
    onFollowUp={() => {}}
  />);
  expect(screen.getByText('second review request')).not.toBeNull();
  expect(screen.getByText('new question')).not.toBeNull();
  expect(screen.queryByText('first review request')).toBeNull();
  expect(screen.queryByText('old question')).toBeNull();
});
