import type { SupabaseClient } from "supabase";

// Fail-closed, same rationale as the analyze function: the feature flag is the
// master kill-switch. A DB hiccup must never cause a research instrument to
// silently start collecting data.
export async function isFlagOn(
  client: SupabaseClient,
  topic: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("activated")
    .select("activated")
    .eq("topic", topic)
    .maybeSingle();
  if (error) {
    console.error("[flag] isFlagOn DB error:", error);
    return false;
  }
  return data?.activated === true;
}
