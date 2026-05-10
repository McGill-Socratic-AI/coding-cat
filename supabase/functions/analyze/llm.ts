import Anthropic from "anthropic";

// Reach the type via the namespace exposed by the default export — avoids
// fragile subpath imports through Deno's npm resolver.
export type PromptParams = Pick<
  Anthropic.Messages.MessageCreateParamsNonStreaming,
  "system" | "messages" | "max_tokens"
>;

export interface LLMResult {
  text: string;
  latencyMs: number;
}

export function makeAnthropic(): Anthropic {
  return new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
}

// Hard timeout for the LLM call. Anthropic occasionally hangs on a
// connection; without a timeout the function would burn its full
// edge-function wall-clock budget waiting. The handler upstream catches
// this as `kind: 'upstream'` and returns 502.
const LLM_TIMEOUT_MS = 30_000;

export async function callLLM(
  client: Anthropic,
  model: string,
  params: PromptParams,
): Promise<LLMResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  const t0 = performance.now();
  try {
    const resp = await client.messages.create(
      { model, ...params },
      { signal: controller.signal },
    );
    const latencyMs = performance.now() - t0;

    const block = resp.content.find((b: any) => b.type === "text");
    const text = block && "text" in block ? (block as { text: string }).text : "";

    return { text, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}
