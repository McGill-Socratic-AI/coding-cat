// End-to-end: the AI Analysis panel as a real multi-turn conversation.
//
// Drives the production bundle in a browser through
//   review -> follow-up -> follow-up -> new review -> follow-up
// against the fake backend in mockBackend.ts. What is asserted here is the
// app's own behaviour: what the browser SENT (the stored thread id and the
// student's typed words, which is how the earlier exchange is carried) and what
// the panel RENDERED. The server-side rules behind those responses — the
// follow-up cap boundary and thread access control — are covered by the Deno
// tests in supabase/functions/analyze/thread_test.ts.

import { test, expect, Page } from '@playwright/test';
import {
  FakeAnalyze,
  FOLLOWUPS_LIMIT,
  installMockBackend,
  THREAD_ID,
} from './mockBackend';

const PROBLEM = 'concat_no_double';
const PROBLEM_URL = `/#/problems/${PROBLEM}`;

const PASSING_CODE = `def concat_no_double(a: str, b: str) -> str:
    if a and b and a[-1] == b[0]:
        return a + b[1:]
    return a + b
`;

async function setEditorCode(page: Page, code: string) {
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible' });
  await expect
    .poll(() => page.evaluate(() => !!(window as any).monaco?.editor?.getEditors()?.length), {
      timeout: 20_000,
    })
    .toBe(true);
  await page.evaluate(code => {
    const editor = (window as any).monaco.editor.getEditors()[0];
    const model = editor.getModel();
    editor.executeEdits('e2e', [
      { range: model.getFullModelRange(), text: code, forceMoveMarkers: true },
    ]);
    editor.pushUndoStop();
  }, code);
}

/** Run the student's code so the panel leaves its "run your code first" state. */
async function runCode(page: Page) {
  await setEditorCode(page, PASSING_CODE);
  await page.getByRole('button', { name: /^run/i }).first().click();
  // Brython executes the tests in a web worker; the report table is the signal.
  await expect(page.getByRole('heading', { name: /^\s*Results\s*$/i })).toBeVisible({
    timeout: 60_000,
  });
}

async function acknowledgeDisclosure(page: Page) {
  const panel = aiPanel(page);
  const checkbox = panel.locator('input[type="checkbox"]').first();
  if (!(await checkbox.isChecked())) await checkbox.check();
  await expect(panel.getByRole('button', { name: /generate analysis/i })).toBeVisible();
}

/** The AI Analysis card, so assertions never match the Results table by accident. */
function aiPanel(page: Page) {
  return page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: /^\s*AI Analysis\s*$/i }) })
    .last();
}

function followUpBox(page: Page) {
  return page.getByLabel('Follow-up question');
}

async function askFollowUp(page: Page, text: string) {
  await followUpBox(page).fill(text);
  await aiPanel(page).getByRole('button', { name: /^ask$/i }).click();
}

/** Open the problem with a working analysis panel and a first review done. */
async function reviewed(page: Page, analyze: FakeAnalyze) {
  await installMockBackend(page, { analyze });
  await page.goto(PROBLEM_URL);
  await runCode(page);
  await acknowledgeDisclosure(page);
  await aiPanel(page).getByRole('button', { name: /generate analysis/i }).click();
  await expect(page.getByText(/Review 1:/)).toBeVisible();
}

test.describe('AI Analysis follow-up conversation', () => {
  test('a student asks follow-ups and each answer takes the earlier exchange into account', async ({
    page,
  }) => {
    const analyze = new FakeAnalyze();
    await reviewed(page, analyze);

    // --- follow-up 1 ---
    await askFollowUp(page, 'why does the empty-string case work?');
    await expect(page.getByText('why does the empty-string case work?', { exact: true })).toBeVisible();
    await expect(page.getByText(/Tutor reply 1:/)).toBeVisible();

    // --- follow-up 2 ---
    await askFollowUp(page, 'and what about a one-character string?');
    await expect(page.getByText('and what about a one-character string?', { exact: true })).toBeVisible();
    await expect(page.getByText(/Tutor reply 2:/)).toBeVisible();

    // Both exchanges stay on screen, in order.
    await expect(page.getByText('why does the empty-string case work?', { exact: true })).toBeVisible();
    await expect(page.getByText(/Tutor reply 1:/)).toBeVisible();

    // This is the multi-turn contract at the wire level: every follow-up
    // carries the thread id the first review handed back, which is what lets
    // the backend continue the same Socratic session instead of starting over.
    const followUps = analyze.requests.filter(r => r.followUp);
    expect(followUps).toHaveLength(2);
    expect(followUps.map(r => r.followUp!.threadId)).toEqual([THREAD_ID, THREAD_ID]);
    expect(followUps.map(r => r.followUp!.message)).toEqual([
      'why does the empty-string case work?',
      'and what about a one-character string?',
    ]);
    // The student's own words are sent, not a regenerated opener.
    expect(analyze.requests[0].followUp).toBeUndefined();

    // The input clears and stays usable for the next turn.
    await expect(followUpBox(page)).toHaveValue('');
    await expect(page.getByText(`2/${FOLLOWUPS_LIMIT} follow-up questions used`)).toBeVisible();
  });

  test('a new analysis starts a fresh conversation and a fresh follow-up allowance', async ({
    page,
  }) => {
    const analyze = new FakeAnalyze();
    await reviewed(page, analyze);

    await askFollowUp(page, 'is there a neater way to write the guard?');
    await expect(page.getByText(/Tutor reply 1:/)).toBeVisible();
    await expect(page.getByText(`1/${FOLLOWUPS_LIMIT} follow-up questions used`)).toBeVisible();

    // Generate a second analysis on the same problem.
    await aiPanel(page).getByRole('button', { name: /generate analysis/i }).click();
    await expect(page.getByText(/Review 2:/)).toBeVisible();

    // The earlier conversation is about older code, so it is no longer listed
    // under the new review, and the allowance has reset.
    await expect(page.getByText('is there a neater way to write the guard?', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Tutor reply 1:/)).toHaveCount(0);
    await expect(page.getByText(`0/${FOLLOWUPS_LIMIT} follow-up questions used`)).toBeVisible();

    // ...and a follow-up still works, continuing the same thread.
    await askFollowUp(page, 'what is the complexity now?');
    await expect(page.getByText(/Tutor reply 2:/)).toBeVisible();
    const last = analyze.requests[analyze.requests.length - 1];
    expect(last.followUp).toEqual({
      threadId: THREAD_ID,
      message: 'what is the complexity now?',
    });
  });

  test('the conversation reaches its cap and says how to start fresh', async ({ page }) => {
    const analyze = new FakeAnalyze();
    // Report the conversation as already at its cap rather than driving ten
    // real turns: the cap rule itself is a server concern, what matters here is
    // that the panel stops offering the input and explains why.
    analyze.forceFollowUpsUsed = FOLLOWUPS_LIMIT;
    await reviewed(page, analyze);

    await expect(followUpBox(page)).toHaveCount(0);
    await expect(
      page.getByText(new RegExp(`used all ${FOLLOWUPS_LIMIT} follow-up questions`, 'i')),
    ).toBeVisible();
    await expect(page.getByText(/Generate a new analysis to start fresh/i)).toBeVisible();
  });

  test('a stored conversation re-opens after a reload', async ({ page }) => {
    const analyze = new FakeAnalyze();
    const now = '2026-10-09T12:00:00.000Z';
    await installMockBackend(page, {
      analyze,
      storedThread: {
        threadId: THREAD_ID,
        rows: [
          { id: 1, role: 'user', source: 'review', content: 'Requested an analysis of my code.', turn_index: 0, created_at: now },
          { id: 2, role: 'assistant', source: 'review', content: 'Stored review: what does line 2 do?', turn_index: 1, created_at: now },
          { id: 3, role: 'user', source: 'followup', content: 'stored question about slicing', turn_index: 2, created_at: now },
          { id: 4, role: 'assistant', source: 'followup', content: 'Stored answer about slicing', turn_index: 3, created_at: now },
        ],
      },
    });

    await page.goto(PROBLEM_URL);
    await runCode(page);
    await acknowledgeDisclosure(page);

    // No fresh review on screen, so the whole stored conversation shows.
    await expect(page.getByText('Your earlier conversation')).toBeVisible();
    await expect(page.getByText('Stored review: what does line 2 do?')).toBeVisible();
    await expect(page.getByText('stored question about slicing', { exact: true })).toBeVisible();
    await expect(page.getByText('Stored answer about slicing')).toBeVisible();
    await expect(page.getByText(`1/${FOLLOWUPS_LIMIT} follow-up questions used`)).toBeVisible();

    // And a follow-up continues that stored thread, not a new one.
    await askFollowUp(page, 'picking up where we left off');
    await expect(page.getByText(/Tutor reply 1:/)).toBeVisible();
    await expect(page.getByText('Stored answer about slicing')).toBeVisible();
    await expect(page.getByText(`2/${FOLLOWUPS_LIMIT} follow-up questions used`)).toBeVisible();
    expect(analyze.requests[0].followUp).toEqual({
      threadId: THREAD_ID,
      message: 'picking up where we left off',
    });
  });

  test('a failed follow-up is reported without losing the analysis or the conversation', async ({
    page,
  }) => {
    const analyze = new FakeAnalyze();
    await reviewed(page, analyze);

    analyze.failOnce(429, {
      ok: false,
      kind: 'turn_limit',
      message: 'This conversation has reached its limit of 10 follow-up questions.',
    });
    await askFollowUp(page, 'this one will fail');
    // The real hook reads the structured AnalyzeError off the response body.
    await expect(page.getByText(/Error: turn_limit/)).toBeVisible();

    // The review the student is reading survives the failed follow-up.
    await expect(page.getByText(/Review 1:/)).toBeVisible();
    // ...and they can still ask again.
    await expect(followUpBox(page)).toBeVisible();
  });

  test('a signed-out visitor never sees the conversation', async ({ page }) => {
    const analyze = new FakeAnalyze();
    await installMockBackend(page, { analyze, signedIn: false });
    await page.goto(PROBLEM_URL);
    await runCode(page);

    await expect(page.getByRole('heading', { name: /^\s*AI Analysis\s*$/i })).toHaveCount(0);
    await expect(followUpBox(page)).toHaveCount(0);
    expect(analyze.requests).toHaveLength(0);
  });
});
