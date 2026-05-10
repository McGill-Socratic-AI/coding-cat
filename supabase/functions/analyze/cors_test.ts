import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corsHeaders, handleOptions } from "./cors.ts";

Deno.test("corsHeaders includes required CORS keys", () => {
  const h = corsHeaders();
  assertEquals(h["Access-Control-Allow-Origin"], "*");
  assertEquals(h["Access-Control-Allow-Headers"], "authorization, content-type");
  assertEquals(h["Access-Control-Allow-Methods"], "POST, OPTIONS");
});

Deno.test("handleOptions returns 204 with CORS headers", () => {
  const req = new Request("http://localhost", { method: "OPTIONS" });
  const res = handleOptions(req);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});
