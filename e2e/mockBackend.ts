// mockBackend.ts — the backend the end-to-end suite runs the real UI against.
//
// Nothing listens on SUPABASE_URL. Every request the app makes to it is
// fulfilled in the browser, so the suite needs no Supabase project, no
// credentials, and spends no Socratic/Anthropic calls. The app itself is the
// real production bundle: real `useAnalyze`, real `AnalysisPanel`, real
// `session && featureMap['AIAnalysis']` gate.
//
// Scope discipline: `FakeAnalyze` stands in for the analyze Edge Function as a
// *response contract*, not as a second copy of its rules. The assertions in the
// specs are about what the browser SENT and what the UI RENDERED; the
// authoritative server rules (follow-up cap boundary, access control) are
// covered by the Deno tests in supabase/functions/analyze/thread_test.ts.

import { Page, Route } from '@playwright/test';

// Must match the REACT_APP_SUPABASE_URL the build under test was given
// (see the `build:e2e` script in package.json).
export const SUPABASE_URL = 'http://localhost:54321';

// supabase-js derives its auth storage key from the URL's first hostname label:
// `sb-${new URL(authUrl).hostname.split('.')[0]}-auth-token`.
export const AUTH_STORAGE_KEY = 'sb-localhost-auth-token';

export const TEST_USER_ID = '7f1c9e3a-5b2d-4a7e-9c11-2f8e4d6b0a35';
export const THREAD_ID = '3f6b1d58-8c21-4e9a-bb47-10c5a2d9e8f1';

export const FOLLOWUPS_LIMIT = 10;

export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  source: 'review' | 'followup';
  content: string;
  turnIndex: number;
  createdAt: string;
}

export interface AnalyzeBody {
  code: string;
  meta: { name: string };
  followUp?: { threadId: string; message: string };
}

/**
 * Stand-in for POST /functions/v1/analyze.
 *
 * Appends the turn it is sent and echoes the whole thread back, the way the
 * real function does after `appendTurn` + `loadThread`. `followUpsUsed` can be
 * forced with `forceFollowUpsUsed` so a spec can put the UI at its cap without
 * driving ten real turns through it.
 */
export class FakeAnalyze {
  turns: Turn[];
  /** Every request body the app sent, in order. */
  requests: AnalyzeBody[] = [];
  /** When set, reported as `followUpsUsed` instead of the counted value. */
  forceFollowUpsUsed: number | null = null;
  /** Fail the next call with this status/body, once. */
  private failNext: { status: number; body: unknown } | null = null;

  private reviewCount = 0;
  private followUpCount = 0;

  /** `turns` seeds the thread the fake already holds, mirroring stored rows. */
  constructor(turns: Turn[] = []) {
    this.turns = [...turns];
  }

  failOnce(status: number, body: unknown) {
    this.failNext = { status, body };
  }

  /** Turns since the latest review — the conversation the student is in now. */
  private currentConversation(): Turn[] {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      if (this.turns[i].source === 'review' && this.turns[i].role === 'user') {
        return this.turns.slice(i);
      }
    }
    return this.turns;
  }

  handle(body: AnalyzeBody): { status: number; json: unknown } {
    this.requests.push(body);

    if (this.failNext) {
      const { status, body: failBody } = this.failNext;
      this.failNext = null;
      return { status, json: failBody };
    }

    const isFollowUp = !!body.followUp;
    let studentText: string;
    let reply: string;

    if (isFollowUp) {
      this.followUpCount += 1;
      studentText = body.followUp!.message;
      // Deliberately does not quote the question back: the specs match the
      // student's bubble by exact text, and an echo would match twice.
      reply = `Tutor reply ${this.followUpCount}: and what would happen at the boundary?`;
    } else {
      this.reviewCount += 1;
      studentText = 'Requested an analysis of my code.';
      reply = `Review ${this.reviewCount}: what happens when the list is empty?`;
    }

    const now = new Date().toISOString();
    const base = this.turns.length;
    const source = isFollowUp ? 'followup' : 'review';
    this.turns.push(
      { id: `t${base}`, role: 'user', source, content: studentText, turnIndex: base, createdAt: now },
      { id: `t${base + 1}`, role: 'assistant', source, content: reply, turnIndex: base + 1, createdAt: now },
    );

    const counted = this.currentConversation().filter(
      t => t.role === 'user' && t.source === 'followup',
    ).length;

    return {
      status: 200,
      json: {
        ok: true,
        analysis: reply,
        usage: { dailyUsed: this.reviewCount, problemUsed: this.reviewCount },
        thread: {
          threadId: THREAD_ID,
          messages: this.turns,
          followUpsUsed: this.forceFollowUpsUsed ?? counted,
          followUpsLimit: FOLLOWUPS_LIMIT,
        },
      },
    };
  }
}

/** Rows the conversation re-open path reads back on a fresh page load. */
export interface StoredThread {
  threadId: string;
  rows: Array<{
    id: number;
    role: 'user' | 'assistant';
    source: 'review' | 'followup';
    content: string;
    turn_index: number;
    created_at: string;
  }>;
}

export interface MockOptions {
  analyze: FakeAnalyze;
  /** Pre-existing conversation for this user+problem; omit for none. */
  storedThread?: StoredThread;
  /** Set false to exercise the feature-flag-off path. */
  aiAnalysisOn?: boolean;
  /** Set false to run as a signed-out visitor. */
  signedIn?: boolean;
}

function session() {
  // expires_at is in seconds and far in the future, so supabase-js uses the
  // stored session as-is and never calls the token endpoint.
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  return {
    access_token: 'e2e-access-token',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    expires_at: expiresAt,
    refresh_token: 'e2e-refresh-token',
    user: {
      id: TEST_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'e2e@example.test',
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

/**
 * Install the fake backend and (optionally) a signed-in session, then the
 * caller navigates. Must run before the app boots, hence addInitScript.
 */
export async function installMockBackend(page: Page, opts: MockOptions) {
  const { analyze, storedThread, aiAnalysisOn = true, signedIn = true } = opts;

  // Keep the fake's thread consistent with what the re-open path reads back, so
  // a follow-up on a stored conversation returns that conversation plus the new
  // turn rather than replacing it.
  if (storedThread && analyze.turns.length === 0) {
    analyze.turns = storedThread.rows.map(r => ({
      id: String(r.id),
      role: r.role,
      source: r.source,
      content: r.content,
      turnIndex: r.turn_index,
      createdAt: r.created_at,
    }));
  }

  if (signedIn) {
    const value = JSON.stringify(session());
    await page.addInitScript(
      ({ key, value }) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* private mode — the spec's own assertions will catch the fallout */
        }
      },
      { key: AUTH_STORAGE_KEY, value },
    );
  }

  // Brython (the in-browser Python runtime behind the Run button) is NOT
  // intercepted: it executes the tests in a web worker, and page.route cannot
  // serve that worker's importScripts, which leaves the runtime half-loaded.
  // So the suite does need network for that one CDN script, exactly as the app
  // does in a browser. Everything else is served from here.
  await page.route(`${SUPABASE_URL}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    }

    // --- auth: the session is already in localStorage ---
    if (pathname.startsWith('/auth/v1/')) {
      if (pathname.endsWith('/user')) {
        return signedIn ? json(route, session().user) : json(route, { message: 'no session' }, 401);
      }
      return json(route, {});
    }

    // --- the analyze Edge Function ---
    if (pathname === '/functions/v1/analyze') {
      const body = JSON.parse(request.postData() ?? '{}') as AnalyzeBody;
      const { status, json: payload } = analyze.handle(body);
      return json(route, payload, status);
    }

    // --- PostgREST ---
    if (pathname === '/rest/v1/activated') {
      return json(route, [
        { topic: 'AIAnalysis', activated: aiAnalysisOn },
        { topic: 'Haystack', activated: true },
        { topic: 'Mutation', activated: true },
      ]);
    }

    if (pathname === '/rest/v1/profiles') {
      return json(route, { is_admin: false });
    }

    if (pathname === '/rest/v1/analyze_threads') {
      if (method !== 'GET') return json(route, []);
      // RLS scopes this to the caller server-side; signed out means no rows.
      if (!signedIn || !storedThread) return json(route, null);
      return json(route, { id: storedThread.threadId });
    }

    if (pathname === '/rest/v1/analyze_messages') {
      if (method !== 'GET') return json(route, []);
      if (!signedIn || !storedThread) return json(route, []);
      return json(route, storedThread.rows);
    }

    if (pathname === '/rest/v1/submissions') {
      // useEval writes here and only console.errors on failure, so an empty
      // answer is enough and keeps the suite from asserting on persistence.
      return json(route, []);
    }

    if (pathname === '/rest/v1/contracts' || pathname === '/rest/v1/reflections') {
      return json(route, []);
    }

    // Anything the app adds later should fail loudly rather than silently 200.
    return json(route, { message: `unmocked route: ${method} ${pathname}` }, 501);
  });
}
