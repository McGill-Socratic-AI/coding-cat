import { handleOptions, corsHeaders } from "./cors.ts";
import { clientFromAuthHeader, getUserId, makeServiceClient } from "./auth.ts";
import { isFlagOn } from "./flag.ts";
import { checkLimits, nextUtcMidnightISO, readUsage } from "./rate_limit.ts";
import type { AnalyzeError, AnalyzeRequest, AnalyzeThread, Usage } from "./types.ts";
import { callSocratic } from "./socratic.ts";
import { logAndRecomputeUsage } from "./log.ts";
import {
  appendTurn,
  countDailyFollowUps,
  countThreadFollowUps,
  findOwnedThread,
  gateFollowUp,
  getOrCreateThread,
  loadThread,
  MAX_FOLLOWUPS_PER_THREAD,
  reviewTurnLabel,
  setSocraticSession,
  unsavedTurn,
  validateFollowUp,
  type ThreadRow,
} from "./thread.ts";

// Length caps — defense against authenticated users sending oversized
// payloads (storage + Anthropic token cost).
const MAX_CODE_LEN = 50_000;
const MAX_PROBLEM_NAME_LEN = 200;

const MODEL_REVIEW = "socratic";
const MODEL_FOLLOWUP = "socratic-followup";

function jsonError(
  kind: AnalyzeError["kind"],
  message: string,
  status: number,
  extra: Partial<AnalyzeError> = {},
): Response {
  const body: AnalyzeError = { ok: false, kind, message, ...extra };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function jsonOk(analysis: string, usage: Usage, thread: AnalyzeThread): Response {
  return new Response(
    JSON.stringify({ ok: true, analysis, usage, thread }),
    { status: 200, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError("invalid_input", "Method not allowed", 405);
  }

  // Auth
  const client = clientFromAuthHeader(req.headers.get("Authorization"));
  const userId = await getUserId(client);
  if (!userId) {
    return jsonError("auth", "Authentication required", 401);
  }

  // Feature flag
  const flagOn = await isFlagOn(client, "AIAnalysis");
  if (!flagOn) {
    return jsonError("flag_off", "AI Analysis is currently disabled", 403);
  }

  // Parse the body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_input", "Invalid JSON body", 400);
  }
  const reqBody = body as AnalyzeRequest;

  // Validate body shape — callSocratic and downstream code assume these
  // fields exist with the right types. Without these checks, malformed
  // bodies cause an unhandled TypeError → 500 + stack trace leak.
  const problemName = reqBody?.meta?.name;
  if (typeof problemName !== "string" || problemName.length === 0) {
    return jsonError("invalid_input", "meta.name is required", 400);
  }
  if (problemName.length > MAX_PROBLEM_NAME_LEN) {
    return jsonError(
      "invalid_input",
      `meta.name exceeds ${MAX_PROBLEM_NAME_LEN} character limit`,
      400,
    );
  }
  if (typeof reqBody.meta?.title !== "string") {
    return jsonError("invalid_input", "meta.title (string) is required", 400);
  }
  if (typeof reqBody.description !== "string") {
    return jsonError("invalid_input", "description (string) is required", 400);
  }
  if (typeof reqBody.starter !== "string") {
    return jsonError("invalid_input", "starter (string) is required", 400);
  }
  if (typeof reqBody.code !== "string") {
    return jsonError("invalid_input", "code (string) is required", 400);
  }
  if (reqBody.code.length > MAX_CODE_LEN) {
    return jsonError(
      "invalid_input",
      `code exceeds ${MAX_CODE_LEN} character limit`,
      400,
    );
  }
  if (!Array.isArray(reqBody.testReport)) {
    return jsonError("invalid_input", "testReport (array) is required", 400);
  }

  // Server-side mutation reject (defense-in-depth; the FE gate is best-effort)
  const questionType = reqBody?.meta?.question_type?.[0];
  if (questionType === "mutation") {
    return jsonError(
      "invalid_input",
      "Mutation problems are not supported by AI Analysis",
      400,
    );
  }

  // A follow-up continues an existing thread; its absence means "review this
  // submission", which is the single-turn behaviour this function started with.
  const rawFollowUp = reqBody.followUp;
  const isFollowUp = rawFollowUp !== undefined && rawFollowUp !== null;
  let followUpMessage = "";
  let followUpThreadId = "";
  if (isFollowUp) {
    const validated = validateFollowUp(rawFollowUp);
    if (!validated.ok) return jsonError("invalid_input", validated.error, 400);
    followUpMessage = validated.message;
    followUpThreadId = rawFollowUp.threadId;
  }

  // Thread reads and writes need the service-role client: neither thread table
  // has a student-side write policy, by design (see the migration and auth.ts).
  const serviceClient = makeServiceClient();

  let thread: ThreadRow;
  let usage: Usage;

  if (isFollowUp) {
    // Access control + the two follow-up budgets. findOwnedThread refuses a
    // thread that is not the caller's, and gateFollowUp reports that exactly
    // like a thread that does not exist, so ids cannot be probed.
    let gate;
    try {
      const owned: ThreadRow | null = await findOwnedThread(
        serviceClient,
        userId,
        followUpThreadId,
      );
      gate = gateFollowUp({
        thread: owned,
        problemName,
        threadFollowUps: owned
          ? await countThreadFollowUps(serviceClient, owned.id)
          : 0,
        dailyFollowUps: owned ? await countDailyFollowUps(serviceClient, userId) : 0,
      });
    } catch (e) {
      console.error("follow-up admission failed:", e);
      return jsonError("unknown", "Could not load the conversation", 500);
    }

    if (!gate.allowed) {
      if (gate.kind === "thread_not_found") {
        return jsonError("thread_not_found", "Conversation not found", 404);
      }
      if (gate.kind === "turn_limit") {
        return jsonError(
          "turn_limit",
          `This conversation has reached its limit of ${MAX_FOLLOWUPS_PER_THREAD} follow-up questions. Generate a new analysis to start fresh.`,
          429,
        );
      }
      return jsonError(
        "rate_limit",
        "Daily follow-up question limit reached",
        429,
        { retryAt: nextUtcMidnightISO() },
      );
    }
    thread = gate.thread;

    usage = await readUsage(client, userId, problemName);
  } else {
    // Review path: the existing daily / per-problem caps, unchanged.
    const limits = await checkLimits(client, userId, problemName);
    if (!limits.allowed) {
      return jsonError(
        "rate_limit",
        limits.kind === "daily"
          ? "Daily analysis limit reached"
          : "Per-problem analysis limit reached for today",
        429,
        { retryAt: limits.retryAt, usage: limits.usage },
      );
    }
    usage = limits.usage;

    try {
      thread = await getOrCreateThread(serviceClient, userId, problemName);
    } catch (e) {
      console.error("thread create failed:", e);
      return jsonError("unknown", "Could not start the conversation", 500);
    }
  }

  // Call Socratic. Passing the stored session id is what carries the earlier
  // exchange: the Socratic API replays that session's prior turns into the
  // prompt, so the transcript never travels in our request.
  let analysis: string;
  let latencyMs: number;
  let socraticSessionId: string | null;
  try {
    const result = await callSocratic(reqBody, userId, {
      sessionId: thread.socratic_session_id,
      message: isFollowUp ? followUpMessage : undefined,
    });
    analysis = result.analysis;
    latencyMs = result.latencyMs;
    socraticSessionId = result.sessionId;
  } catch (e) {
    console.error("socratic upstream error:", e);
    return jsonError("upstream", "Analysis service is temporarily unavailable", 502);
  }

  if (socraticSessionId && socraticSessionId !== thread.socratic_session_id) {
    await setSocraticSession(serviceClient, thread.id, socraticSessionId);
  }

  // Record the turn. Best-effort, like the analyze_calls log: a storage hiccup
  // must not cost the student the reply they already waited for.
  const source = isFollowUp ? "followup" : "review";
  const studentMessage = isFollowUp
    ? followUpMessage
    : reviewTurnLabel(reqBody.testReport);
  let persisted = true;
  try {
    await appendTurn(serviceClient, {
      threadId: thread.id,
      userId,
      source,
      studentMessage,
      code: reqBody.code,
      reply: analysis,
      model: isFollowUp ? MODEL_FOLLOWUP : MODEL_REVIEW,
      latencyMs,
    });
  } catch (e) {
    console.error("[thread] appendTurn failed:", e);
    persisted = false;
  }

  let threadState: AnalyzeThread;
  try {
    threadState = await loadThread(serviceClient, thread.id);
  } catch (e) {
    console.error("[thread] loadThread failed:", e);
    threadState = {
      threadId: thread.id,
      messages: [],
      followUpsUsed: 0,
      followUpsLimit: MAX_FOLLOWUPS_PER_THREAD,
    };
    persisted = false;
  }

  // The panel renders the thread, so a turn that failed to store (or to reload)
  // would make the reply the student just waited for vanish. Hand it back
  // anyway, marked as unsaved so it is not mistaken for a stored turn.
  if (!persisted) {
    threadState = unsavedTurn(threadState, source, studentMessage, analysis);
  }

  // A follow-up has its own budget and leaves analyze_calls — the review
  // cost/audit log that drives the panel's counters — untouched.
  if (!isFollowUp) {
    // Uses a service-role client because RLS has no INSERT policy on
    // analyze_calls (by design — see auth.ts).
    usage = await logAndRecomputeUsage(serviceClient, {
      userId,
      problemName,
      code: reqBody.code,
      response: analysis,
      model: MODEL_REVIEW,
      latencyMs: Math.round(latencyMs),
    }, usage);
  }

  return jsonOk(analysis, usage, threadState);
});

