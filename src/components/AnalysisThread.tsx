import { Box, Button, Stack, Textarea, Typography } from '@mui/joy';
import { useState } from 'react';
import Markdown from 'markdown-to-jsx';
import { AnalyzeThread, ThreadMessage } from '../types';
import { MAX_FOLLOWUP_LEN } from '../utils/analysisLimits';
import type { FollowUpState } from '../hooks/useAnalyse';

type AnalysisThreadProps = {
  thread: AnalyzeThread;
  // Which turns to render. The panel passes only the follow-up turns when the
  // review reply is already shown above, and the whole conversation when it is
  // re-opening a stored thread.
  messages: ThreadMessage[];
  heading: string;
  followUp: FollowUpState;
  onFollowUp: (message: string) => void | Promise<void>;
  // True while a fresh review is running, so the two calls cannot overlap.
  busy?: boolean;
};

function Bubble({ message }: { message: ThreadMessage }) {
  const isStudent = message.role === 'user';
  return (
    <Box
      sx={{
        alignSelf: isStudent ? 'flex-end' : 'flex-start',
        maxWidth: '92%',
        px: 2,
        py: 1,
        borderRadius: 12,
        border: '1px solid',
        borderColor: isStudent ? 'neutral.300' : 'primary.300',
        backgroundColor: isStudent ? 'background.level1' : 'primary.50',
      }}
    >
      <Typography level="body-xs" sx={{ mb: 0.5, fontStyle: 'italic' }}>
        {isStudent ? 'You' : 'Coding Cat'}
      </Typography>
      {isStudent
        ? <Typography sx={{ whiteSpace: 'pre-wrap' }}>{message.content}</Typography>
        : <Markdown>{message.content}</Markdown>}
    </Box>
  );
}

export default function AnalysisThread({
  thread, messages, heading, followUp, onFollowUp, busy = false,
}: AnalysisThreadProps) {
  const [draft, setDraft] = useState('');

  const atTurnLimit = thread.followUpsUsed >= thread.followUpsLimit;
  const awaitingReply = followUp.status === 'loading';
  // Disabled while either call is in flight so the two cannot overlap.
  const sending = awaitingReply || busy;
  const trimmed = draft.trim();
  const tooLong = trimmed.length > MAX_FOLLOWUP_LEN;
  const canSend = trimmed.length > 0 && !tooLong && !sending && !atTurnLimit;

  async function send() {
    if (!canSend) return;
    const message = trimmed;
    setDraft('');
    await onFollowUp(message);
  }

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      {messages.length > 0 && (
        <>
          <Typography level="title-sm">{heading}</Typography>
          <Stack spacing={1.5}>
            {messages.map(m => <Bubble key={m.id} message={m} />)}
          </Stack>
        </>
      )}

      {awaitingReply && (
        <Typography sx={{ textAlign: 'center', fontStyle: 'italic' }}>
          Thinking...
        </Typography>
      )}

      {followUp.status === 'error' && (
        <Box>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>
            <strong>Error: {followUp.kind}.</strong> {followUp.message}
          </Typography>
          {followUp.retryAt && <Typography> Try again after {followUp.retryAt}. </Typography>}
        </Box>
      )}

      {atTurnLimit ? (
        <Typography level="body-sm" sx={{ fontStyle: 'italic' }}>
          You&apos;ve used all {thread.followUpsLimit} follow-up questions in this
          conversation. Generate a new analysis to start fresh.
        </Typography>
      ) : (
        <Stack spacing={1}>
          <Textarea
            placeholder="Ask a follow-up question about your code..."
            value={draft}
            minRows={2}
            maxRows={6}
            disabled={sending}
            slotProps={{ textarea: { maxLength: MAX_FOLLOWUP_LEN, 'aria-label': 'Follow-up question' } }}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography level="body-xs">
              {thread.followUpsUsed}/{thread.followUpsLimit} follow-up questions used
              {' · '}{draft.length}/{MAX_FOLLOWUP_LEN} characters
            </Typography>
            <Button size="sm" disabled={!canSend} onClick={send}>
              {awaitingReply ? 'Sending...' : 'Ask'}
            </Button>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
