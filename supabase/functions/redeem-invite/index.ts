import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const normalizeCode = (value: string) => value.trim().toUpperCase();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    console.error("Required Supabase function environment is missing.");
    return respond(500, { error: "service_unavailable" });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return respond(401, { error: "sign_in_required" });
  }

  // Verify the caller's token with Supabase Auth. Do not trust a user ID sent in JSON.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return respond(401, { error: "sign_in_required" });

  let payload: { code?: unknown };
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "invalid_request" });
  }

  if (typeof payload.code !== "string" || payload.code.length > 80) {
    return respond(400, { error: "invalid_request" });
  }
  const code = normalizeCode(payload.code);
  // Generated codes use VAYNTR- followed by 32 hex characters (128 bits of randomness).
  if (!/^VAYNTR-[0-9A-F]{32}$/.test(code)) {
    return respond(400, { error: "invalid_or_expired_code" });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: allowed, error: rateError } = await admin.rpc("consume_invite_attempt", {
    p_user_id: authData.user.id,
  });
  if (rateError) {
    console.error("Invite rate-limit check failed:", rateError.message);
    return respond(503, { error: "service_unavailable" });
  }
  if (!allowed) return respond(429, { error: "too_many_attempts", retryAfterSeconds: 900 });

  const keyHash = await sha256Hex(code);
  const { data: result, error: redeemError } = await admin.rpc("redeem_invite_code", {
    p_key_hash: keyHash,
    p_user_id: authData.user.id,
  });
  if (redeemError) {
    console.error("Invite redemption failed:", redeemError.message);
    return respond(503, { error: "service_unavailable" });
  }

  if (result !== "redeemed") {
    // Same response for unknown, expired, revoked, and already-used codes.
    return respond(400, { error: "invalid_or_expired_code" });
  }

  return respond(200, { ok: true, message: "Invitation redeemed. Your member access is now active." });
});
