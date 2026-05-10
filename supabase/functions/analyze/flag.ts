import type { SupabaseClient } from "supabase";

// Note on fail-closed: on any DB error or missing row, this returns false.
// The feature flag is the master kill-switch — a DB hiccup must NOT cause
// the feature to silently accidentally activate. This is asymmetric with
// rate_limit.ts (which fail-opens for cost-guard semantics).
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
