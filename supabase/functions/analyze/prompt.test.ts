import { assertEquals, assertStringIncludes, assertFalse } from "https://deno.land/std@0.208.0/assert/mod.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { buildPrompt } from "./prompt.ts";
import type { AnalyzeRequest } from "./types.ts";
import { FIXTURES } from "./fixtures.ts";

/**
 * HELPER: Extracts text from Anthropic content blocks.
 * Safely parses string or array of text blocks.
 */
function getText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => (typeof block === "string" ? block : block.text || "")).join("\n");
  }
  return "";
}

// ============================================================================
// 1. UNIT TESTS (Fast, Deterministic)
// ============================================================================

Deno.test("Unit: Prompt builder branches correctly on passing tests", () => {
  const output = buildPrompt(FIXTURES.makes_ten.pass);
  const userMessage = getText(output.messages[0].content);
  
  assertStringIncludes(userMessage, "The student passed all tests!");
  assertFalse(userMessage.includes("focusing the student's attention on specific inputs"));
});

Deno.test("Unit: Prompt builder branches correctly on failing tests", () => {
  const output = buildPrompt(FIXTURES.is_even.fail);
  const userMessage = getText(output.messages[0].content);

  assertStringIncludes(userMessage, "Use the provided test results to guide your hints");
  assertStringIncludes(userMessage, "FAIL");
});

Deno.test("Unit: Injects CRITICAL haystack instructions only for haystack problems", () => {
  const haystackOutput = buildPrompt(FIXTURES.jellybean_naming_crisis.fail);
  const codingOutput = buildPrompt(FIXTURES.minutes_to_seconds.fail);

  const haystackSystem = getText(haystackOutput.system);
  const codingSystem = getText(codingOutput.system);

  assertStringIncludes(haystackSystem, "CRITICAL: This is a 'haystack' problem");
  assertFalse(codingSystem.includes("haystack"));
});

// ============================================================================
// 2. EVAL SUITE (Slow, Real LLM call)
// Run via: DENO_ENV=eval deno test --allow-net --allow-env prompt.test.ts
// ============================================================================

const isEval = Deno.env.get("DENO_ENV") === "eval";

if (isEval) {
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "mock" });
  const MODEL = "claude-sonnet-4-6";

  function assertValidResponse(responseText: string, fixtureName: string, expectPass: boolean) {
    // Assert 1: Length blow-out cap
    assertFalse(responseText.length > 1500, `Length blow-out: Response was ${responseText.length} chars.`);

    // Assert 2: Off-topic check (Relaxed for natural language)
    const responseLower = responseText.toLowerCase();
    const talksAboutCode = responseLower.includes("code") || 
                           responseLower.includes("test") || 
                           responseLower.includes("input") || 
                           responseLower.includes("you") || 
                           responseLower.includes("time complexity") ||
                           responseLower.includes("optimize");
                           
    const mentionsName = responseText.includes(fixtureName);
    
    // It's valid if it either mentions the specific function name OR uses standard tutoring/coding words
    const isOffTopic = !mentionsName && !talksAboutCode;
    assertFalse(isOffTopic, "Response appears off-topic; did not reference the context or tutoring concepts.");

    // Assert 3: Solution leakage / Corrected code blocks
    if (!expectPass) {
      const hasPythonBlock = responseText.includes("```python") || responseText.includes("```py");
      assertFalse(hasPythonBlock, "Solution leakage: LLM generated a python code block.");
    }
  }

  // Loop through ALL fixtures and dynamically create tests!
  for (const [key, fixtureStates] of Object.entries(FIXTURES)) {
    
    // Test the Passing State
    Deno.test(`Eval [PASS] - ${key}`, async () => {
      const promptData = buildPrompt(fixtureStates.pass);
      const response = await anthropic.messages.create({ model: MODEL, ...promptData });
      
      const responseText = getText(response.content);
      assertValidResponse(responseText, fixtureStates.pass.meta.name, true);
    });

    // Test the Failing State
    Deno.test(`Eval [FAIL] - ${key}`, async () => {
      const promptData = buildPrompt(fixtureStates.fail);
      const response = await anthropic.messages.create({ model: MODEL, ...promptData });
      
      const responseText = getText(response.content);
      assertValidResponse(responseText, fixtureStates.fail.meta.name, false);
    });
  }
}