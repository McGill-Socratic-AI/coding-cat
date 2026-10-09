import type { ThreadMessage } from '../types';

// The turns from the latest review onwards: the conversation the student is in
// now. A thread keeps every earlier review and its follow-ups, but those are
// about older code, and a new analysis starts a fresh follow-up allowance.
//
// Mirrors currentConversation in supabase/functions/analyze/thread.ts, which
// draws the same boundary for the server-side follow-up cap — keep the two in
// sync so the count the panel shows and the cap the server enforces agree.
export function currentConversation(messages: ThreadMessage[]): ThreadMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].source === 'review' && messages[i].role === 'user') {
      return messages.slice(i);
    }
  }
  return messages;
}

export function countFollowUps(messages: ThreadMessage[]): number {
  return currentConversation(messages).filter(m => m.role === 'user' && m.source === 'followup').length;
}
