import type { SupabaseClient } from "supabase";
import type { Usage } from "./types.ts";

export interface LogRow {
  userId: string;
  problemName: string;
  code: string;
  response: string;
  model: string;
  latencyMs: number;
}

export async function logAndRecomputeUsage(
  client: SupabaseClient,
  row: LogRow,
  preCallUsage: Usage,
): Promise<Usage> {
  // Insert (best-effort; do not throw on failure)
  const { error: insertError } = await client.from("analyze_calls").insert([{
    user_id: row.userId,
    problem_name: row.problemName,
    code: row.code,
    response: row.response,
    model: row.model,
    latency_ms: row.latencyMs,
  }]);
  if (insertError) console.error("[log] analyze_calls insert failed:", insertError);

  // Recompute counts; fall back to pre+1 on failure
  const todayStart = (() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString();
  })();

  const { count: dailyCount, error: dErr } = await client
    .from("analyze_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", row.userId)
    .gte("created_at", todayStart);

  const { count: problemCount, error: pErr } = await client
    .from("analyze_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", row.userId)
    .eq("problem_name", row.problemName)
    .gte("created_at", todayStart);

  if (dErr) console.error("[log] daily recompute failed; falling back to pre+1:", dErr);
  if (pErr) console.error("[log] problem recompute failed; falling back to pre+1:", pErr);

  return {
    dailyUsed: dErr ? preCallUsage.dailyUsed + 1 : (dailyCount ?? preCallUsage.dailyUsed + 1),
    problemUsed: pErr ? preCallUsage.problemUsed + 1 : (problemCount ?? preCallUsage.problemUsed + 1),
  };
}
