import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFlagOn } from "./flag.ts";

function fakeClient(rows: Array<{ topic: string; activated: boolean }>) {
  return {
    from(_: string) {
      return {
        select(_: string) {
          return {
            eq: (_col: string, _val: string) => ({
              maybeSingle: async () => ({
                data: rows.find((r) => r.topic === "AIAnalysis") ?? null,
                error: null,
              }),
            }),
          };
        },
      };
    },
  };
}

Deno.test("isFlagOn returns true when row is on", async () => {
  const c = fakeClient([{ topic: "AIAnalysis", activated: true }]);
  assertEquals(await isFlagOn(c as any, "AIAnalysis"), true);
});

Deno.test("isFlagOn returns false when row is off", async () => {
  const c = fakeClient([{ topic: "AIAnalysis", activated: false }]);
  assertEquals(await isFlagOn(c as any, "AIAnalysis"), false);
});

Deno.test("isFlagOn returns false when row missing", async () => {
  const c = fakeClient([]);
  assertEquals(await isFlagOn(c as any, "AIAnalysis"), false);
});

Deno.test("isFlagOn returns false on DB error", async () => {
  const c = {
    from(_: string) {
      return {
        select(_: string) {
          return {
            eq: (_col: string, _val: string) => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: "boom" },
              }),
            }),
          };
        },
      };
    },
  };
  assertEquals(await isFlagOn(c as any, "AIAnalysis"), false);
});
