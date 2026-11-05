"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const source = readFileSync("server.js", "utf8");

assert.match(source, /app\.use\(["']\/api\/staff["'],\s*staffAuthLimiter\)/,
  "Staff routes must have a dedicated unsuccessful-access rate limiter.");
assert.match(source, /skipSuccessfulRequests:\s*true/,
  "Successful staff dashboard calls should not consume the failed-access budget.");
assert.match(source, /limit:\s*10/,
  "Staff access failures must be rate-limited.");
assert.match(source, /crypto\.timingSafeEqual\(supplied, expected\)/,
  "Staff token comparison must use a timing-safe comparison.");
assert.match(source, /rejectUnauthorized:\s*process\.env\.PG_SSL_REJECT_UNAUTHORIZED\s*!==\s*["']false["']/,
  "The database TLS connection must stay fail-secure: certificate verification on by default, opt-out only via an explicit PG_SSL_REJECT_UNAUTHORIZED=false setting.");
assert.match(source, /res\.set\(["']Cache-Control["'],\s*["']no-store, private["']\)/,
  "Protected staff responses must disable caching.");

const staffRoutes = source.split("\n").filter((line) =>
  /app\.(?:get|post|put|patch|delete)\(["']\/api\/staff\//.test(line)
);
assert.ok(staffRoutes.length > 0, "At least one staff route should be found.");
const staffAuthRoutes = staffRoutes.filter((line) => /\/api\/staff\/auth\//.test(line));
const staffDataRoutes = staffRoutes.filter((line) => !/\/api\/staff\/auth\//.test(line));
for (const route of staffDataRoutes) {
  assert.match(route, /requireStaffAccess/,
    "Every staff data endpoint must include requireStaffAccess: " + route.trim());
}
// Sign-in routes are public by design; anything that reads or changes staff data is not.
assert.ok(staffAuthRoutes.length >= 8,
  "Staff identity routes (bootstrap, activate, login, verify, logout, me, accounts, disable) must exist.");
for (const route of staffAuthRoutes) {
  if (/\/api\/staff\/auth\/(?:logout|me|accounts)/.test(route)) {
    assert.match(route, /requireStaffAccess/,
      "Staff session routes must require a signed-in staff identity: " + route.trim());
  }
}

const publicRosterStart = source.indexOf('app.get("/api/roster"');
const publicRosterEnd = source.indexOf('app.post("/api/recruitment/applications"', publicRosterStart);
assert.ok(publicRosterStart >= 0 && publicRosterEnd > publicRosterStart,
  "Public roster route should be identifiable.");
const publicRosterRoute = source.slice(publicRosterStart, publicRosterEnd);
assert.doesNotMatch(publicRosterRoute, /SELECT[^\n]*\bemail\b/i,
  "Public roster query must not select contact email addresses.");

assert.match(source, /res\.status\(500\)\.json\(\{ error: ["']An unexpected server error occurred\.["'] \}\)/,
  "Unexpected server errors must use a generic public response.");
assert.match(source, /entity\.parse\.failed/,
  "Malformed JSON must be handled without returning an internal error.");
assert.match(source, /entity\.too\.large/,
  "Oversized JSON must be handled without returning an internal error.");

// Cross-origin member actions (avatar remove) preflight DELETE; missing it silently breaks the button.
const corsMethodsMatch = source.match(/methods:\s*\[([^\]]*)\]/);
assert.ok(corsMethodsMatch && /"DELETE"/.test(corsMethodsMatch[1]) && /"OPTIONS"/.test(corsMethodsMatch[1]),
  "CORS must allow DELETE plus OPTIONS so preflighted member actions are not rejected.");

// Schema safety: on a fresh database every ALTER TABLE must follow its table's CREATE TABLE.
const schemaStart = source.indexOf("const schema = `") + "const schema = `".length;
const schemaEnd = source.indexOf("`;", schemaStart);
assert.ok(schemaEnd > schemaStart, "The database schema string must be present.");
const schemaSlice = source.slice(schemaStart, schemaEnd);
for (const alter of schemaSlice.match(/ALTER TABLE \w+/g) || []) {
  const tableName = alter.replace("ALTER TABLE ", "");
  const createAt = schemaSlice.indexOf("CREATE TABLE IF NOT EXISTS " + tableName);
  assert.ok(createAt >= 0 && createAt < schemaSlice.indexOf(alter),
    "ALTER statements must run after their table's CREATE so first-boot schema setup cannot fail: " + tableName);
}

// Guest-facing regressions that syntax checks and link checks cannot catch.
assert.doesNotMatch(source, /storedSocialLinks/,
  "The application insert must serialize the validated socialLinks value; an undeclared identifier returns 500 for every applicant.");
assert.match(source, /JSON\.stringify\(socialLinks\)/,
  "Recruitment applications must store the validated social links.");
const memberScript = readFileSync("auth.js", "utf8");
assert.match(memberScript, /^\s*let memberState = null;$/m,
  "The member portal must declare memberState before assigning to it; strict mode throws ReferenceError otherwise.");
assert.doesNotMatch(memberScript, /const expiry = new Date\(\);/,
  "The member portal must not keep unused locals.");
assert.match(readFileSync("member.html", "utf8"), /type="password" minlength="12"/,
  "The member password field must require the 12-character minimum the API enforces.");
assert.match(readFileSync("recruitment.html", "utf8"), /role="group" aria-labelledby="mediaSkillLabel"/,
  "The media-skill checkbox group must be labelled as a group rather than a fieldset legend placed after other content.");
assert.match(readFileSync("player.js", "utf8"), /text\(copy, "h2", "player-profile__name"/,
  "Player profiles must render exactly one h1 on the page.");

// Member pictures are embedded cross-origin by the public roster: without an explicit CORP
// override Helmet's same-origin default silently blocks the image in every browser.
assert.match(source, /app\.get\("\/api\/members\/:id\/avatar"[\s\S]*?Cross-Origin-Resource-Policy", "cross-origin"/,
  "The public avatar route must allow cross-origin embedding.");
assert.match(source, /Permissions-Policy/,
  "API responses must deny unused device permissions.");
assert.match(source, /express\.json\(\{ limit: "20kb", strict: true \}\)/,
  "The JSON body parser must reject non-object JSON payloads.");

// Staff privileges are per-person and second-factor gated. The shared key is a one-time
// migration credential and must never be a standing way into staff data.
assert.match(source, /async function requireStaffAccess\(req, res, next\)/,
  "Staff access must resolve a per-user session, not a shared token.");
assert.match(source, /FROM staff_sessions s JOIN staff_accounts a/,
  "Staff access must be backed by a per-user session row joined to a staff identity.");
assert.match(source, /staff\.mfa_enabled !== true/,
  "A staff session without an enabled second factor must be refused.");
assert.match(source, /staff_shared_token_refused/,
  "Presenting the legacy shared token must be refused and recorded as a security event.");
assert.doesNotMatch(source, /req\.user = \{ id: null, display_name: "VAYNTR staff token"/,
  "The shared token must never be converted into a staff identity.");
assert.match(source, /app\.post\("\/api\/staff\/auth\/bootstrap"[\s\S]*?safeTokenEquals\(suppliedToken\.trim\(\), STAFF_REVIEW_TOKEN\)/,
  "The setup key must only be accepted by the one-time bootstrap route.");
assert.match(source, /Bootstrap is closed/,
  "Bootstrap must close permanently once a staff identity exists.");
assert.match(source, /last_totp_step/,
  "Staff authenticator codes must be single-use (replay protection).");
assert.match(source, /staff_mfa_replay/,
  "A replayed staff authenticator code must be refused and recorded.");
assert.match(source, /STAFF_LOCKOUT_THRESHOLD/,
  "Staff sign-in must have its own progressive lockout.");
assert.match(source, /CREATE TABLE IF NOT EXISTS staff_accounts/,
  "Staff identities must be stored in their own table.");
assert.match(source, /CREATE TABLE IF NOT EXISTS staff_sessions/,
  "Staff sessions must be stored server-side as hashed tokens.");
assert.match(source, /CREATE TABLE IF NOT EXISTS staff_mfa_challenges/,
  "Staff two-factor challenges must be stored as hashed tokens.");
assert.match(source, /INSERT INTO security_events \(event_type, account_id, staff_id, actor/,
  "Security events must record which staff identity acted.");
assert.ok((source.match(/staff_action/g) || []).length >= 10,
  "Every mutating staff route must record a staff_action event with the acting identity.");
assert.match(source, /SELECT COUNT\(\*\)::int AS count FROM staff_accounts WHERE disabled_at IS NULL AND mfa_enabled = TRUE/,
  "Staff readiness must require a migrated identity with a verified second factor.");
assert.doesNotMatch(source, /staffReviewConfigured: STAFF_REVIEW_TOKEN\.length >= 32/,
  "Staff readiness must not be inferred from the shared token alone.");
assert.match(source, /requireStaffReady/,
  "Applicant intake must stay paused until a second-factor-verified reviewer exists.");

// A brand-new database has to bootstrap in a single pass: every foreign key target must already
// exist when the referencing table is created, otherwise a fresh deploy dies at startup.
const bootSchema = (source.match(/const schema = `([\s\S]*?)`;/) || [null, ""])[1];
assert.ok(bootSchema.length > 0, "The bootstrap schema should be present in server.js.");
for (const reference of bootSchema.matchAll(/REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/gi)) {
  const target = reference[1];
  const created = bootSchema.indexOf("CREATE TABLE IF NOT EXISTS " + target + " (");
  assert.ok(created >= 0, "Schema references a table it never creates: " + target);
  assert.ok(created < reference.index,
    "Schema must create " + target + " before referencing it (fresh-database bootstrap order).");
}

console.log("Security source checks passed.");
