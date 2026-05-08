import { handleOptions, corsHeaders } from "./cors.ts";
import { clientFromAuthHeader, getUserId } from "./auth.ts";
import { isFlagOn } from "./flag.ts";
import { checkLimits } from "./rate_limit.ts";
import type { AnalyzeError } from "./types.ts";
import type { AnalyzeRequest } from "./types.ts";
import { buildPrompt } from "./prompt.ts";
import { makeAnthropic, callLLM } from "./llm.ts";

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
  // Minimal shape check; full validation will harden later
  const reqBody = body as AnalyzeRequest;
  const problemName = reqBody?.meta?.name;
  if (!problemName) {
    return jsonError("invalid_input", "meta.name is required", 400);
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
    const result = await callLLM(anthropic, "claude-haiku-4-5", promptParams);
    analysis = result.text;
    latencyMs = result.latencyMs;
  } catch (e) {
    console.error("LLM upstream error:", e);
    return jsonError("upstream", "Analysis service is temporarily unavailable", 502);
  }

  // Placeholder usage; Task 6 will recompute post-insert.
  return new Response(
    JSON.stringify({ ok: true, analysis, usage: limits.usage }),
    { status: 200, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
  );
});
