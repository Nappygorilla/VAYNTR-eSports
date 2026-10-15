import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

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
    .from("profiles").select("role,membership_status").eq("id", authData.user.id).maybeSingle();
  if (profileError) return respond(503, { error: "service_unavailable" });
  if (!profile || !["staff", "admin"].includes(profile.role)) return respond(403, { error: "staff_only" });

  let payload: { label?: unknown };
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "invalid_request" });
  }
  const label = typeof payload.label === "string" ? payload.label.trim().slice(0, 120) : null;

  // 128 bits of cryptographically secure randomness. The plaintext is returned once only.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const randomPart = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  const code = "VAYNTR-" + randomPart;
  const keyHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: row, error: insertError } = await admin
    .from("invite_codes")
    .insert({
      key_hash: keyHash,
      issued_by: authData.user.id,
      expires_at: expiresAt,
      label: label || null,
    })
    .select("id,expires_at,issued_at")
    .single();

  if (insertError || !row) {
    console.error("Invite creation failed:", insertError?.message);
    return respond(503, { error: "service_unavailable" });
  }

  return respond(201, {
    id: row.id,
    code,
    expiresAt: row.expires_at,
    issuedAt: row.issued_at,
    warning: "Copy this code now. The plaintext code is not stored and cannot be retrieved later.",
  });
});
