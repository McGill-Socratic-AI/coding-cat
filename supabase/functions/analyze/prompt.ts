// PLACEHOLDER prompt — replaced by P1 (issue #7). Do not iterate on prompt
// quality here; Person C owns the real implementation.

import type { AnalyzeRequest } from "./types.ts";
import type { PromptParams } from "./llm.ts";

export function buildPrompt(input: AnalyzeRequest): PromptParams {
  const allPass = input.testReport.every((r) => r.equal);
  const status = allPass ? "All tests passed." : "Some tests failed.";
  return {
    system:
      "You are a teaching assistant for an introductory Python course. " +
      "Help the student improve their solution. Do NOT give them the answer. " +
      "Keep your reply under 300 words.",
    messages: [{
      role: "user",
      content:
        `Problem: ${input.meta.title}\n\n` +
        `${input.description}\n\n` +
        `Student code:\n\`\`\`python\n${input.code}\n\`\`\`\n\n` +
        `${status}`,
    }],
    max_tokens: 600,
  };
}
