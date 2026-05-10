import { handleOptions, corsHeaders } from "./cors.ts";
import { clientFromAuthHeader, getUserId, makeServiceClient } from "./auth.ts";
import { isFlagOn } from "./flag.ts";
import { checkLimits } from "./rate_limit.ts";
import type { AnalyzeError, AnalyzeRequest } from "./types.ts";
import { buildPrompt } from "./prompt.ts";
import { makeAnthropic, callLLM } from "./llm.ts";
import { logAndRecomputeUsage } from "./log.ts";

// Model alias — auto-tracks the latest Haiku 4.5 snapshot. Pin to a
// specific snapshot (e.g., claude-haiku-4-5-20251001) when behavior
// stability becomes more important than auto-fixes.
const MODEL = "claude-haiku-4-5";

// Length caps — defense against authenticated users sending oversized
// payloads (storage + Anthropic token cost).
const MAX_CODE_LEN = 50_000;
const MAX_PROBLEM_NAME_LEN = 200;

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

  // Validate body shape — buildPrompt and downstream code assume these
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

  // Rate limits
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

  // Build prompt and call LLM
  const promptParams = buildPrompt(reqBody);
  let analysis: string;
  let latencyMs: number;
  try {
    const anthropic = makeAnthropic();
    const result = await callLLM(anthropic, MODEL, promptParams);
    analysis = result.text;
    latencyMs = result.latencyMs;
  } catch (e) {
    console.error("LLM upstream error:", e);
    return jsonError("upstream", "Analysis service is temporarily unavailable", 502);
  }

  // Log + recompute usage. Uses a service-role client because RLS has no
  // INSERT policy on analyze_calls (by design — see auth.ts).
  const serviceClient = makeServiceClient();
  const fresh = await logAndRecomputeUsage(serviceClient, {
    userId,
    problemName,
    code: reqBody.code,
    response: analysis,
    model: MODEL,
    latencyMs: Math.round(latencyMs),
  }, limits.usage);

  return new Response(
    JSON.stringify({ ok: true, analysis, usage: fresh }),
    { status: 200, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
  );
});
