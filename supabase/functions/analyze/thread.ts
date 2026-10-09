// thread.ts — the multi-turn conversation behind the AI Analysis panel.
//
// A thread is one conversation per (user, problem); see the
// 20261009000000_analyze_threads.sql migration for the schema and the RLS
// contract. Every function here takes a SERVICE-ROLE client: neither table has
// a student-side write policy on purpose, so only this function may create a
// thread or append a turn.
//
// The transcript stored here is a projection for the UI. The authoritative turn
// history lives in the Socratic API, keyed by analyze_threads.socratic_session_id.

import type { SupabaseClient } from "supabase";
import type { AnalyzeThread, ThreadMessage } from "./types.ts";

// Follow-ups per conversation, where a conversation is everything since the
// thread's latest review: generating a new analysis starts a fresh allowance.
// Bounds cost, prompt growth upstream, and the length of the panel.
export const MAX_FOLLOWUPS_PER_THREAD = 10;

// Follow-ups per student per UTC day, across every problem. The cost guard —
// the analogue of rate_limit.ts DAILY_CAP, which stays dedicated to reviews so
// that asking follow-ups never consumes a student's review budget.
export const FOLLOWUP_DAILY_CAP = 30;

// Length cap on one follow-up question. Well under the Socratic API's own 8k
// message limit; keeps storage and token cost per turn predictable.
export const MAX_FOLLOWUP_LEN = 2_000;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ThreadRow {
  id: string;
  user_id: string;
  problem_name: string;
  socratic_session_id: string | null;
}

const THREAD_COLS = "id, user_id, problem_name, socratic_session_id";

function todayUtcStartISO(now: Date = new Date()): string {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )).toISOString();
}

// Resolve the student's thread for this problem, creating it on first review.
// UNIQUE (user_id, problem_name) makes the insert the race arbiter: on a
// duplicate-key collision the row the other request just wrote is the answer.
export async function getOrCreateThread(
  client: SupabaseClient,
  userId: string,
  problemName: string,
): Promise<ThreadRow> {
  const existing = await findThreadByProblem(client, userId, problemName);
  if (existing) return existing;

  const { data, error } = await client
    .from("analyze_threads")
    .insert({ user_id: userId, problem_name: problemName })
    .select(THREAD_COLS)
    .single();

  if (!error) return data as ThreadRow;

  if ((error as { code?: string }).code === "23505") {
    const again = await findThreadByProblem(client, userId, problemName);
    if (again) return again;
  }
  throw error;
}

async function findThreadByProblem(
  client: SupabaseClient,
  userId: string,
  problemName: string,
): Promise<ThreadRow | null> {
  const { data, error } = await client
    .from("analyze_threads")
    .select(THREAD_COLS)
    .eq("user_id", userId)
    .eq("problem_name", problemName)
    .maybeSingle();
  if (error) throw error;
  return (data as ThreadRow | null) ?? null;
}

// Access control for follow-ups. A thread that does not exist and a thread
// belonging to someone else are deliberately indistinguishable to the caller,
// so a client cannot probe for other students' thread ids.
export async function findOwnedThread(
  client: SupabaseClient,
  userId: string,
  threadId: string,
): Promise<ThreadRow | null> {
  const { data, error } = await client
    .from("analyze_threads")
    .select(THREAD_COLS)
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;

  const row = data as ThreadRow | null;
  if (!row) return null;
  if (row.user_id !== userId) return null;
  return row;
}

// Follow-ups asked since the thread's latest review — the same boundary
// currentConversation draws for toAnalyzeThread, so the cap the server enforces
// and the count the panel shows cannot disagree.
export async function countThreadFollowUps(
  client: SupabaseClient,
  threadId: string,
): Promise<number> {
  const { data: latest, error: latestError } = await client
    .from("analyze_messages")
    .select("turn_index")
    .eq("thread_id", threadId)
    .eq("source", "review")
    .order("turn_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  const reviewTurn = (latest as { turn_index: number } | null)?.turn_index;

  let query = client
    .from("analyze_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("role", "user")
    .eq("source", "followup");
  if (typeof reviewTurn === "number") query = query.gt("turn_index", reviewTurn);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function countDailyFollowUps(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await client
    .from("analyze_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .eq("source", "followup")
    .gte("created_at", todayUtcStartISO());
  if (error) throw error;
  return count ?? 0;
}

export async function setSocraticSession(
  client: SupabaseClient,
  threadId: string,
  socraticSessionId: string,
): Promise<void> {
  const { error } = await client
    .from("analyze_threads")
    .update({
      socratic_session_id: socraticSessionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);
  // Best-effort: losing the session id only costs the next follow-up one
  // extra upstream lookup, since the API can resolve the session by tenancy.
  if (error) console.error("[thread] session id update failed:", error);
}

export interface AppendTurnArgs {
  threadId: string;
  userId: string;
  source: "review" | "followup";
  studentMessage: string;
  code: string;
  reply: string;
  model: string;
  latencyMs: number;
}

// Append one question/reply pair. Both rows go in together so the panel never
// renders a dangling question. turn_index comes from the current tail, and the
// UNIQUE (thread_id, turn_index) constraint catches the (rare) concurrent
// append — one retry is enough because the FE disables the input while a turn
// is in flight.
export async function appendTurn(
  client: SupabaseClient,
  args: AppendTurnArgs,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = await nextTurnIndex(client, args.threadId);
    const { error } = await client.from("analyze_messages").insert([
      {
        thread_id: args.threadId,
        user_id: args.userId,
        turn_index: next,
        role: "user",
        source: args.source,
        content: args.studentMessage,
        code: args.code,
      },
      {
        thread_id: args.threadId,
        user_id: args.userId,
        turn_index: next + 1,
        role: "assistant",
        source: args.source,
        content: args.reply,
        model: args.model,
        latency_ms: Math.round(args.latencyMs),
      },
    ]);
    if (!error) return;
    if ((error as { code?: string }).code !== "23505" || attempt === 1) {
      throw error;
    }
  }
}

async function nextTurnIndex(
  client: SupabaseClient,
  threadId: string,
): Promise<number> {
  const { data, error } = await client
    .from("analyze_messages")
    .select("turn_index")
    .eq("thread_id", threadId)
    .order("turn_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const tail = (data as { turn_index: number } | null)?.turn_index;
  return typeof tail === "number" ? tail + 1 : 0;
}

export interface MessageRow {
  id: number | string;
  role: "user" | "assistant";
  source: "review" | "followup";
  content: string;
  turn_index: number;
  created_at: string;
}

// The turns from the latest review onwards: the conversation the student is in
// now. Earlier reviews and their follow-ups stay stored but are about older code.
export function currentConversation<
  T extends { role: "user" | "assistant"; source: "review" | "followup" },
>(messages: T[]): T[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].source === "review" && messages[i].role === "user") {
      return messages.slice(i);
    }
  }
  return messages;
}

function countFollowUps(messages: ThreadMessage[]): number {
  return currentConversation(messages).filter(
    (m) => m.role === "user" && m.source === "followup",
  ).length;
}

export function toAnalyzeThread(
  threadId: string,
  rows: MessageRow[],
): AnalyzeThread {
  const messages: ThreadMessage[] = rows.map((r) => ({
    id: String(r.id),
    role: r.role,
    source: r.source,
    content: r.content,
    turnIndex: r.turn_index,
    createdAt: r.created_at,
  }));
  return {
    threadId,
    messages,
    followUpsUsed: countFollowUps(messages),
    followUpsLimit: MAX_FOLLOWUPS_PER_THREAD,
  };
}

export async function loadThread(
  client: SupabaseClient,
  threadId: string,
): Promise<AnalyzeThread> {
  const { data, error } = await client
    .from("analyze_messages")
    .select("id, role, source, content, turn_index, created_at")
    .eq("thread_id", threadId)
    .order("turn_index", { ascending: true });
  if (error) throw error;
  return toAnalyzeThread(threadId, (data ?? []) as MessageRow[]);
}

// What the student's own turn says in the stored transcript for a review. The
// message actually sent upstream is composed by socratic.ts/buildStudentMessage
// from the test results; showing that generated paragraph back to the student as
// if they had typed it would be confusing, so the transcript records the action.
export function reviewTurnLabel(testReport: Array<{ equal: boolean }>): string {
  const total = testReport.length;
  if (total === 0) return "Requested an analysis of my code.";
  const passed = testReport.filter((r) => r.equal).length;
  return `Requested an analysis of my code (${passed}/${total} tests passing).`;
}

// --- Follow-up admission (pure) -------------------------------------------
//
// Validation and the two budget checks live here, away from index.ts request
// plumbing, so the rules that decide whether a follow-up runs are unit-testable
// on their own.

export type FollowUpValidation =
  | { ok: true; message: string }
  | { ok: false; error: string };

export function validateFollowUp(raw: unknown): FollowUpValidation {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "followUp must be an object" };
  }
  const f = raw as { threadId?: unknown; message?: unknown };
  if (typeof f.threadId !== "string" || !UUID_RE.test(f.threadId)) {
    return { ok: false, error: "followUp.threadId must be a conversation id" };
  }
  if (typeof f.message !== "string") {
    return { ok: false, error: "followUp.message (string) is required" };
  }
  const message = f.message.trim();
  if (message.length === 0) {
    return { ok: false, error: "followUp.message cannot be empty" };
  }
  if (message.length > MAX_FOLLOWUP_LEN) {
    return {
      ok: false,
      error: `followUp.message exceeds ${MAX_FOLLOWUP_LEN} character limit`,
    };
  }
  return { ok: true, message };
}

export type FollowUpGate =
  | { allowed: true; thread: ThreadRow }
  | { allowed: false; kind: "thread_not_found" | "turn_limit" | "rate_limit" };

export function gateFollowUp(args: {
  thread: ThreadRow | null;
  problemName: string;
  threadFollowUps: number;
  dailyFollowUps: number;
}): FollowUpGate {
  // findOwnedThread already returns null for another student's thread; the
  // problem check keeps a thread id from being replayed against a different
  // problem's context. Both answer "not found" so ids cannot be probed.
  if (!args.thread || args.thread.problem_name !== args.problemName) {
    return { allowed: false, kind: "thread_not_found" };
  }
  if (args.threadFollowUps >= MAX_FOLLOWUPS_PER_THREAD) {
    return { allowed: false, kind: "turn_limit" };
  }
  if (args.dailyFollowUps >= FOLLOWUP_DAILY_CAP) {
    return { allowed: false, kind: "rate_limit" };
  }
  return { allowed: true, thread: args.thread };
}

// Append a turn that could not be persisted to the thread we hand back, so the
// reply is not lost. The ids are local to this response; a later reload simply
// will not show the turn.
export function unsavedTurn(
  thread: AnalyzeThread,
  source: "review" | "followup",
  studentMessage: string,
  reply: string,
): AnalyzeThread {
  const now = new Date().toISOString();
  const base = thread.messages.length > 0
    ? thread.messages[thread.messages.length - 1].turnIndex + 1
    : 0;
  const messages = [
    ...thread.messages,
    {
      id: `unsaved-${base}`,
      role: "user" as const,
      source,
      content: studentMessage,
      turnIndex: base,
      createdAt: now,
    },
    {
      id: `unsaved-${base + 1}`,
      role: "assistant" as const,
      source,
      content: reply,
      turnIndex: base + 1,
      createdAt: now,
    },
  ];
  return {
    ...thread,
    messages,
    followUpsUsed: countFollowUps(messages),
  };
}
