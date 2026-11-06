// A local copy of the analyze function's CORS headers: Supabase bundles each
// function directory on its own, so reaching into a sibling function's module
// would couple two independently deployed units.

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function handleOptions(_req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
