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

export async function callLLM(
  client: Anthropic,
  model: string,
  params: PromptParams,
): Promise<LLMResult> {
  const t0 = performance.now();
  const resp = await client.messages.create({ model, ...params });
  const latencyMs = performance.now() - t0;

  const block = resp.content.find((b: any) => b.type === "text");
  const text = block && "text" in block ? (block as { text: string }).text : "";

  return { text, latencyMs };
}
