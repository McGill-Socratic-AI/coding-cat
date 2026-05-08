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

export async function checkLimits(
  client: SupabaseClient,
  userId: string,
  problemName: string,
): Promise<LimitResult> {
  const todayStart = todayUtcStartISO();

  const { count: dailyCount = 0 } = await client
    .from("analyze_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", todayStart);

  const { count: problemCount = 0 } = await client
    .from("analyze_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("problem_name", problemName)
    .gte("created_at", todayStart);

  const usage: Usage = {
    dailyUsed: dailyCount ?? 0,
    problemUsed: problemCount ?? 0,
  };

  if ((dailyCount ?? 0) >= DAILY_CAP) {
    return { allowed: false, kind: "daily", usage, retryAt: nextUtcMidnightISO() };
  }
  if ((problemCount ?? 0) >= PROBLEM_CAP) {
    return { allowed: false, kind: "problem", usage, retryAt: nextUtcMidnightISO() };
  }
  return { allowed: true, usage };
}
