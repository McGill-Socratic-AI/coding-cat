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
  session_id: null;
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

export function buildSocraticRequest(
  input: AnalyzeRequest,
  userId: string,
): SocraticRequestBody {
  return {
    course_offering_id: SOCRATIC_COURSE_OFFERING,
    student_id: userId,
    problem_ref: input.meta.name,
    session_id: null,
    message: buildStudentMessage(input),
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

export async function callSocratic(
  input: AnalyzeRequest,
  userId: string,
): Promise<{ analysis: string; latencyMs: number }> {
  const token = socraticKey(); // throws if missing — never logs it
  const body = buildSocraticRequest(input, userId);

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
    throw new Error(
      `Socratic API returned non-JSON (status ${res.status}): ${e}`,
    );
  }

  if (!res.ok) {
    const kind = (json as any)?.kind ?? "unknown";
    const msg = (json as any)?.message ?? "(no message)";
    throw new Error(
      `Socratic API error: status=${res.status} kind=${kind} message=${msg}`,
    );
  }

  const payload = json as any;
  if (payload?.ok === false) {
    const kind = payload?.kind ?? "unknown";
    const msg = payload?.message ?? "(no message)";
    throw new Error(
      `Socratic API returned ok=false: kind=${kind} message=${msg}`,
    );
  }

  const reply: string | undefined = payload?.reply;
  if (typeof reply !== "string") {
    throw new Error(
      `Socratic API response missing 'reply' field (status ${res.status})`,
    );
  }

  return { analysis: reply, latencyMs };
}
