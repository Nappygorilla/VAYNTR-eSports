import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return respond(500, { error: "service_unavailable" });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return respond(401, { error: "sign_in_required" });

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return respond(401, { error: "sign_in_required" });

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin
    .from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (profileError) return respond(503, { error: "service_unavailable" });
  if (!profile || !["staff", "admin"].includes(profile.role)) return respond(403, { error: "staff_only" });

  let payload: { inviteId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "invalid_request" });
  }
  if (typeof payload.inviteId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.inviteId)) {
    return respond(400, { error: "invalid_request" });
  }

  const { data: row, error: updateError } = await admin
    .from("invite_codes")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", payload.inviteId)
    .is("redeemed_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("Invite revocation failed:", updateError.message);
    return respond(503, { error: "service_unavailable" });
  }
  if (!row) return respond(404, { error: "invite_not_found_or_not_revokeable" });

  return respond(200, { ok: true, message: "Unused invitation revoked." });
});
