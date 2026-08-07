import { createClient, SupabaseClient } from "supabase";

// User-bound client: reads run under the caller's JWT, RLS applies.
export function clientFromAuthHeader(
  authHeader: string | null,
): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: authHeader ? { headers: { Authorization: authHeader } } : {},
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

// Service-role client: bypasses RLS.
//
// self_reported_grades has RLS enabled and zero policies, so this is the ONLY
// way to touch it. Every row this client writes is constructed here from the
// verified caller's own pseudonym — user input never selects which pseudonym a
// row is written under, which is what keeps one student from writing (or
// deleting) another student's data.
export function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function getUserId(
  client: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}
