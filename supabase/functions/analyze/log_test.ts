import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { logAndRecomputeUsage } from "./log.ts";

// Builds a chain that supports both shapes:
//   .select(...).eq("user_id",X).gte("created_at",Y) -> { count: dailyAfter }
//   .select(...).eq("user_id",X).eq("problem_name",P).gte("created_at",Y) -> { count: problemAfter }
function fakeClient(dailyAfter: number, problemAfter: number, fail = false) {
  const inserted: any[] = [];
  function makeChain(eqCalls: number) {
    const node: any = {};
    node.eq = (_c: string, _v: any) => makeChain(eqCalls + 1);
    node.gte = (_c: string, _v: any) =>
      Promise.resolve(
        fail
          ? { count: null, error: { message: "boom" } }
          : { count: eqCalls >= 2 ? problemAfter : dailyAfter, error: null },
      );
    return node;
  }
  return {
    inserted,
    from(_: string) {
      return {
        insert: (rows: any[]) => {
          inserted.push(...rows);
          return Promise.resolve({ error: null });
        },
        select: (_col: string, _opts?: any) => makeChain(0),
      };
    },
  };
}

Deno.test("logAndRecomputeUsage inserts and returns fresh usage", async () => {
  const client = fakeClient(5, 2);
  const result = await logAndRecomputeUsage(client as any, {
    userId: "u",
    problemName: "p",
    code: "c",
    response: "r",
    model: "m",
    latencyMs: 123,
  }, { dailyUsed: 4, problemUsed: 1 });
  assertEquals(result.dailyUsed, 5);
  assertEquals(result.problemUsed, 2);
  assertEquals((client as any).inserted.length, 1);
  assertEquals((client as any).inserted[0].user_id, "u");
});

Deno.test("logAndRecomputeUsage falls back to pre+1 when recompute fails", async () => {
  const client = fakeClient(0, 0, /* fail */ true);
  const result = await logAndRecomputeUsage(client as any, {
    userId: "u",
    problemName: "p",
    code: "c",
    response: "r",
    model: "m",
    latencyMs: 1,
  }, { dailyUsed: 4, problemUsed: 1 });
  assertEquals(result.dailyUsed, 5);
  assertEquals(result.problemUsed, 2);
});
