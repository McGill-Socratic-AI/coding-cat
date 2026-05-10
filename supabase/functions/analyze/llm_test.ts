import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callLLM } from "./llm.ts";

class FakeMessages {
  async create(_: any) {
    return {
      content: [{ type: "text", text: "fake analysis" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  }
}
class FakeAnthropic {
  messages = new FakeMessages();
}

Deno.test("callLLM returns text and latency", async () => {
  const result = await callLLM(
    new FakeAnthropic() as any,
    "claude-haiku-4-5",
    { system: "s", messages: [{ role: "user", content: "u" }], max_tokens: 100 },
  );
  assertEquals(result.text, "fake analysis");
  if (typeof result.latencyMs !== "number" || result.latencyMs < 0) {
    throw new Error("latency invalid");
  }
});
