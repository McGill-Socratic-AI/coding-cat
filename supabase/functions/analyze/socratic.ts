import type { AnalyzeRequest } from "./types.ts";

const SOCRATIC_URL =
  Deno.env.get("SOCRATIC_URL") ??
  "https://ssqtelmhmywzhygkbbgv.supabase.co/functions/v1/socratic";
const SOCRATIC_COURSE_OFFERING =
  Deno.env.get("SOCRATIC_COURSE_OFFERING") ?? "rag-smoke-test";

// Cap the upstream wait so a hung/slow Socratic call fails fast (-> 502) instead
// of burning the edge function's full wall-clock budget. Mirrors the timeout the
// previous local-LLM path enforced.
const SOCRATIC_TIMEOUT_MS = 30_000;

// The Socratic API rejects a message longer than this (8k chars). Our own
// follow-up cap (thread.ts MAX_FOLLOWUP_LEN) is far below it; this is only a
// backstop so a generated message can never trip an upstream 400.
export const MAX_SOCRATIC_MESSAGE_LEN = 8_000;

function socraticKey(): string {
  const k = Deno.env.get("SOCRATIC_PLATFORM_KEY");
  if (!k) throw new Error("SOCRATIC_PLATFORM_KEY is not set");
  return k;
}

export function buildStudentMessage(input: AnalyzeRequest): string {
  const allPass = input.testReport.every((r) => r.equal);
  let msg = allPass
    ? `I'm working on the "${input.meta.title}" problem and all the tests pass now. Can you help me see whether there's anything I could improve — the time/space complexity or the code style?`
    : `I'm working on the "${input.meta.title}" problem. My code runs but it's still failing some of the test cases — can you help me figure out what's going wrong?`;
  if (input.meta.question_type?.includes("haystack")) {
    msg += ` (I think there's a specific concept or pattern I'm meant to use here — please guide me to it without just naming it outright.)`;
  }
  return msg;
}

export interface SocraticRequestBody {
  course_offering_id: string;
  student_id: string;
  problem_ref: string;
  session_id: string | null;
  message: string;
  problem_context: {
    description: string;
    student_code: string;
    test_results: Array<{
      input: string;
      expected: string;
      actual: string;
      equal: boolean;
    }>;
  };
}

export interface SocraticCallOptions {
  // The session the conversation so far lives in. Passing it is what makes a
  // call multi-turn: the Socratic API loads that session's prior turns and
  // replays them into the prompt, so we never ship the transcript ourselves.
  // null/undefined lets the API resolve (or create) the session itself from
  // course_offering_id + student_id + problem_ref.
  sessionId?: string | null;
  // The student's own words on a follow-up turn. Omitted on a review turn, where
  // buildStudentMessage composes the opening message from the test results.
  message?: string;
}

export interface SocraticResult {
  analysis: string;
  latencyMs: number;
  // The session this turn landed in, to store against the thread so the next
  // follow-up continues it. null when the API did not report one.
  sessionId: string | null;
}

export function buildSocraticRequest(
  input: AnalyzeRequest,
  userId: string,
  opts: SocraticCallOptions = {},
): SocraticRequestBody {
  const message = opts.message ?? buildStudentMessage(input);
  return {
    course_offering_id: SOCRATIC_COURSE_OFFERING,
    student_id: userId,
    problem_ref: input.meta.name,
    session_id: opts.sessionId ?? null,
    message: message.slice(0, MAX_SOCRATIC_MESSAGE_LEN),
    problem_context: {
      description: input.description,
      student_code: input.code,
      test_results: input.testReport.map((r) => ({
        input: r.input,
        expected: r.expected,
        actual: r.actual,
        equal: r.equal,
      })),
    },
  };
}

type Attempt =
  | { ok: true; result: SocraticResult }
  | { ok: false; latencyMs: number; message: string; sessionMismatch: boolean };

async function postSocratic(
  body: SocraticRequestBody,
  token: string,
): Promise<Attempt> {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOCRATIC_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(SOCRATIC_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = performance.now() - t0;

  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    return {
      ok: false,
      latencyMs,
      message:
        `Socratic API returned non-JSON (status ${res.status}): ${e}`,
      sessionMismatch: false,
    };
  }

  const payload = json as Record<string, unknown> | null;
  const kind = (payload?.kind as string | undefined) ?? "unknown";

  if (!res.ok) {
    const msg = (payload?.message as string | undefined) ?? "(no message)";
    return {
      ok: false,
      latencyMs,
      message:
        `Socratic API error: status=${res.status} kind=${kind} message=${msg}`,
      sessionMismatch: kind === "session_mismatch",
    };
  }

  if (payload?.ok === false) {
    const msg = (payload?.message as string | undefined) ?? "(no message)";
    return {
      ok: false,
      latencyMs,
      message: `Socratic API returned ok=false: kind=${kind} message=${msg}`,
      sessionMismatch: kind === "session_mismatch",
    };
  }

  const reply = payload?.reply;
  if (typeof reply !== "string") {
    return {
      ok: false,
      latencyMs,
      message:
        `Socratic API response missing 'reply' field (status ${res.status})`,
      sessionMismatch: false,
    };
  }

  const sessionId = payload?.session_id;
  return {
    ok: true,
    result: {
      analysis: reply,
      latencyMs,
      sessionId: typeof sessionId === "string" ? sessionId : null,
    },
  };
}

export async function callSocratic(
  input: AnalyzeRequest,
  userId: string,
  opts: SocraticCallOptions = {},
): Promise<SocraticResult> {
  const token = socraticKey(); // throws if missing — never logs it

  const first = await postSocratic(
    buildSocraticRequest(input, userId, opts),
    token,
  );
  if (first.ok) return first.result;

  // A stored session id that no longer resolves upstream (pruned session, or a
  // Socratic project that was reset) would otherwise wedge the thread forever.
  // Retry once without it: the API then resolves the session from
  // (course_offering, student, problem_ref) on its own, which is the same
  // session the first turn created.
  if (first.sessionMismatch && opts.sessionId) {
    console.warn(
      "socratic session_mismatch; retrying without stored session id",
    );
    const retry = await postSocratic(
      buildSocraticRequest(input, userId, { ...opts, sessionId: null }),
      token,
    );
    if (retry.ok) {
      return {
        ...retry.result,
        latencyMs: first.latencyMs + retry.result.latencyMs,
      };
    }
    throw new Error(retry.message);
  }

  throw new Error(first.message);
}
