import type { SupabaseClient } from "supabase";
import type { Usage } from "./types.ts";

export const DAILY_CAP = 20;
export const PROBLEM_CAP = 5;

export interface LimitOk {
  allowed: true;
  usage: Usage;
}
export interface LimitBlocked {
  allowed: false;
  kind: "daily" | "problem";
  usage: Usage;
  retryAt: string;
}
export type LimitResult = LimitOk | LimitBlocked;

export function nextUtcMidnightISO(now: Date = new Date()): string {
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return tomorrow.toISOString();
}

function todayUtcStartISO(): string {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0,
  )).toISOString();
}

// Note on TOCTOU: checkLimits reads counts and returns; the actual log
// insert happens after the LLM call (see logAndRecomputeUsage). Two
// requests from the same user landing simultaneously can both pass at
// dailyUsed = cap-1 and end at cap+1. This is a soft cap by design;
// the worst case is +1 over the budget per concurrent burst. If a hard
// cap is ever needed, move to a SQL transaction with conditional INSERT.
//
// Note on fail-open: when Supabase returns an error on either count
// query, we log it and treat the count as 0. This is asymmetric with
// flag.ts (which fail-closes). The choice is deliberate: rate limits
// guard cost (a transient DB hiccup shouldn't cause a user-visible 429),
// while the feature flag is the master kill-switch (DB error must not
// accidentally enable a disabled feature).
export async function checkLimits(
  client: SupabaseClient,
  userId: string,
  problemName: string,
): Promise<LimitResult> {
  const todayStart = todayUtcStartISO();

  const { count: dailyCount, error: dailyError } = await client
    .from("analyze_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", todayStart);

  if (dailyError) {
    console.error("[rate_limit] daily count query failed (failing open):", dailyError);
  }

  const { count: problemCount, error: problemError } = await client
    .from("analyze_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("problem_name", problemName)
    .gte("created_at", todayStart);

  if (problemError) {
    console.error("[rate_limit] per-problem count query failed (failing open):", problemError);
  }

  const usage: Usage = {
    dailyUsed: dailyCount ?? 0,
    problemUsed: problemCount ?? 0,
  };

  if (usage.dailyUsed >= DAILY_CAP) {
    return { allowed: false, kind: "daily", usage, retryAt: nextUtcMidnightISO() };
  }
  if (usage.problemUsed >= PROBLEM_CAP) {
    return { allowed: false, kind: "problem", usage, retryAt: nextUtcMidnightISO() };
  }
  return { allowed: true, usage };
}
