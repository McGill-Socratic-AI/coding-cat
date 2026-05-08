import { createClient, SupabaseClient } from "supabase";

// User-bound client: reads run under the caller's JWT, RLS applies.
export function clientFromAuthHeader(authHeader: string | null): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: authHeader ? { headers: { Authorization: authHeader } } : {},
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

// Service-role client: bypasses RLS. Used for trusted server-side writes
// (logging analyze_calls). Never accepts user-controlled input that could
// elevate access — only the function's own constructed rows.
export function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function getUserId(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}
