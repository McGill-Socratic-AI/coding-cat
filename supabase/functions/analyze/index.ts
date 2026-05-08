import { handleOptions, corsHeaders } from "./cors.ts";
import { clientFromAuthHeader, getUserId } from "./auth.ts";
import { isFlagOn } from "./flag.ts";
import type { AnalyzeError } from "./types.ts";

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

  // Placeholder until Tasks 4-7 wire body parsing, LLM call, and real usage.
  return new Response(
    JSON.stringify({ ok: true, analysis: "skeleton placeholder", usage: { dailyUsed: 0, problemUsed: 0 } }),
    { status: 200, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
  );
});
