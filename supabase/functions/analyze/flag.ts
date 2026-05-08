import type { SupabaseClient } from "supabase";

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
