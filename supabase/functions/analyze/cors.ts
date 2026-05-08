export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function handleOptions(_req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
