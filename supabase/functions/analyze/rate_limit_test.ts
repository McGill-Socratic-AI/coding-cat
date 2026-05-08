import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkLimits, DAILY_CAP, PROBLEM_CAP, nextUtcMidnightISO } from "./rate_limit.ts";

// Mock Supabase client builder. Both query chains resolve to (count, error).
//   Daily chain: from(t).select(...).eq("user_id",X).gte("created_at",Y) -> { count: dailyCount }
//   Per-problem: from(t).select(...).eq("user_id",X).eq("problem_name",P).gte("created_at",Y) -> { count: problemCount }
//
// We model the chain by returning the same builder with both `.eq` and `.gte`
// available; whichever leaf the caller hits resolves to the appropriate count.
function fakeClient(dailyCount: number, problemCount: number) {
  function makeChain(eqCalls: number) {
    const node: any = {};
    node.eq = (_col: string, _val: any) => makeChain(eqCalls + 1);
    node.gte = (_col: string, _val: any) =>
      Promise.resolve({
        count: eqCalls >= 2 ? problemCount : dailyCount,
        data: null,
        error: null,
      });
    return node;
  }
  return {
    from(_: string) {
      return {
        select(_col: string, _opts?: any) {
          return makeChain(0);
        },
      };
    },
  };
}

Deno.test("checkLimits passes when both counts under cap", async () => {
  const client = fakeClient(0, 0);
  const result = await checkLimits(client as any, "user-x", "problem-y");
  assertEquals(result.allowed, true);
  assertEquals(result.usage.dailyUsed, 0);
  assertEquals(result.usage.problemUsed, 0);
});

Deno.test("checkLimits blocks at daily cap", async () => {
  const client = fakeClient(DAILY_CAP, 0);
  const result = await checkLimits(client as any, "user-x", "problem-y");
  assertEquals(result.allowed, false);
  if (result.allowed) throw new Error("type guard");
  assertEquals(result.kind, "daily");
  assertEquals(result.usage.dailyUsed, DAILY_CAP);
  assertExists(result.retryAt);
});

Deno.test("checkLimits blocks at per-problem cap", async () => {
  const client = fakeClient(0, PROBLEM_CAP);
  const result = await checkLimits(client as any, "user-x", "problem-y");
  assertEquals(result.allowed, false);
  if (result.allowed) throw new Error("type guard");
  assertEquals(result.kind, "problem");
  assertEquals(result.usage.problemUsed, PROBLEM_CAP);
});

Deno.test("nextUtcMidnightISO returns next-day midnight ISO", () => {
  const now = new Date("2026-05-08T15:30:00Z");
  const next = nextUtcMidnightISO(now);
  assertEquals(next, "2026-05-09T00:00:00.000Z");
});

Deno.test("checkLimits fails open when DB returns error", async () => {
  const client = {
    from(_: string) {
      return {
        select(_col: string, _opts?: any) {
          return {
            eq: (_c: string, _v: any) => ({
              eq: (_c2: string, _v2: any) => ({
                gte: (_c3: string, _v3: any) =>
                  Promise.resolve({ count: null, error: { message: "boom" }, data: null }),
              }),
              gte: (_c2: string, _v2: any) =>
                Promise.resolve({ count: null, error: { message: "boom" }, data: null }),
            }),
          };
        },
      };
    },
  };
  const result = await checkLimits(client as any, "user-x", "problem-y");
  assertEquals(result.allowed, true);
  assertEquals(result.usage.dailyUsed, 0);
  assertEquals(result.usage.problemUsed, 0);
});
