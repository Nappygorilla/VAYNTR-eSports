"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const siteBasePath = "/VAYNTR-eSports/";
const legacyProjectPrefix = "/__no-legacy-prefix__/";
const externalProjectPrefixes = ["/VAYNTR-eSports-warzone-helper/"];
const previewOrigin = "https://nappygorilla.github.io";
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
const errors = [];

function addError(file, message) {
  errors.push(file + ": " + message);
}

// Guard against previously verified runtime regressions that syntax checks cannot catch.
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
if (/(^|[^$])\$\(["']#primaryNav a["']\)\.forEach/.test(appSource)) {
  addError("app.js", "Do not call forEach on querySelector's single result; use querySelectorAll.");
}
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
if (!serverSource.includes('.match(/^Bearer\\s+(.+)$/i)')) {
  addError("server.js", "Staff Authorization must parse Bearer followed by whitespace and a token.");
}


const publicRosterRoute = serverSource.match(/app\.get\(["']\/api\/roster["'][\s\S]*?(?=\napp\.)/);
const publicRosterSelect = publicRosterRoute && publicRosterRoute[0].match(/SELECT\s+([\s\S]*?)\s+FROM roster_players/i);
if (!publicRosterSelect || /\b(?:email|accepted_at)\b/i.test(publicRosterSelect[1])) {
  addError("server.js", "Public roster output must omit contact emails and internal acceptance timestamps.");
}
const staffRosterRoute = serverSource.match(/app\.get\(["']\/api\/staff\/roster["'][\s\S]*?(?=\napp\.)/);
if (!staffRosterRoute || !/requireStaffAccess/.test(staffRosterRoute[0]) ||
    !/SELECT\s+[^;]*\bemail\b[^;]*\bFROM roster_players/i.test(staffRosterRoute[0])) {
  addError("server.js", "Player contact emails must be available only through the authenticated staff roster route.");
}
for (const publicClient of ["roster.js", "player.js"]) {
  const source = fs.readFileSync(path.join(root, publicClient), "utf8");
  if (/\b(?:player|item)\.email\b/i.test(source)) {
    addError(publicClient, "Public roster/profile clients must never consume player contact emails.");
  }
}


const staffSource = fs.readFileSync(path.join(root, "staff.js"), "utf8");
if (!staffSource.includes('const TOKEN_KEY = "vayntr-staff-session"') ||
    !/headers\.Authorization\s*=\s*"Bearer "\s*\+\s*token/.test(staffSource) ||
    !/sessionStorage\.getItem\(TOKEN_KEY\)/.test(staffSource) ||
    !/sessionStorage\.setItem\(TOKEN_KEY,\s*token\)/.test(staffSource) ||
    !/sessionStorage\.removeItem\(TOKEN_KEY\)/.test(staffSource) ||
    /\blocalStorage\b/.test(staffSource)) {
  addError("staff.js", "Staff portal must preserve Bearer-token auth in sessionStorage only.");
}
if (!/cache:\s*"no-store"/.test(staffSource) || !/new AbortController\(\)/.test(staffSource) ||
    !/clearTimeout\(timeout\)/.test(staffSource)) {
  addError("staff.js", "Staff API requests must avoid HTTP caching and have a finite timeout.");
}
const signOutBlock = staffSource.match(/function signOut\(\s*[\s\S]*?\)\s*\{[\s\S]*?\n  \}/);
if (!signOutBlock || !["#applicationsList", "#staffRosterList", "#contentItemsList"].every((selector) => signOutBlock[0].includes(selector))) {
  addError("staff.js", "Signing out must clear application, roster-contact, and content data from the DOM.");
}
if (!/res\.set\(["']Cache-Control["'],\s*["']no-store,\s*private["']\)/.test(serverSource) ||
    !/function requireStaffAccess\([\s\S]*?res\.set\(["']Pragma["'],\s*["']no-cache["']\)/.test(serverSource)) {
  addError("server.js", "Protected staff responses must disable HTTP caching.");
}
const protectedRouteChecks = [
  /app\.get\(["']\/api\/staff\/applications["'],\s*requireDatabase,\s*requireStaffAccess/,
  /app\.get\(["']\/api\/staff\/roster["'],\s*requireDatabase,\s*requireStaffAccess/,
  /app\.post\(["']\/api\/staff\/applications\/:id\/decision["'],\s*requireDatabase,\s*requireStaffAccess/,
  /app\.post\(["']\/api\/staff\/roster\/:id\/update["'],\s*requireDatabase,\s*requireStaffAccess/,
  /app\.post\(["']\/api\/staff\/roster\/:id\/remove["'],\s*requireDatabase,\s*requireStaffAccess/,
  /app\.get\(["']\/api\/staff\/content["'],\s*requireDatabase,\s*requireStaffAccess/,
  /app\.post\(["']\/api\/staff\/content["'],\s*requireDatabase,\s*requireStaffAccess/,
  /app\.post\(["']\/api\/staff\/content\/delete["'],\s*requireDatabase,\s*requireStaffAccess/
];
for (const routePattern of protectedRouteChecks) {
  if (!routePattern.test(serverSource)) addError("server.js", "A staff data/action endpoint is missing private-token authorization.");
}
const decisionRoute = serverSource.match(/app\.post\(["']\/api\/staff\/applications\/:id\/decision["'][\s\S]*?(?=\n\/\/ Removing a roster player)/);
if (!decisionRoute || !/BEGIN/.test(decisionRoute[0]) || !/DELETE FROM recruitment_applications/.test(decisionRoute[0]) ||
    !/decision === "accept"/.test(decisionRoute[0]) || /sendApplicationDecisionEmail/.test(decisionRoute[0])) {
  addError("server.js", "Recruitment decisions must preserve transactional accept/deny deletion and manual email follow-up.");
}
if (/app\.post\(["']\/api\/staff\/applications\/:id\/status["']/.test(serverSource) ||
    /function sendApplicationDecisionEmail\(/.test(serverSource)) {
  addError("server.js", "The obsolete status endpoint must not bypass the atomic roster/application decision flow or send automatic decision emails.");
}

// Member invite codes: generation is server-side, storage is hash-only, plaintext is returned exactly once.
if (!serverSource.includes('app.post("/api/staff/invites"') ||
    !serverSource.includes('hashInviteCode(code)') ||
    !serverSource.includes('INSERT INTO invite_codes (label, code_hash, expires_at)')) {
  addError("server.js", "Invite codes must be generated server-side and stored only as SHA-256 hashes.");
}
if (!serverSource.includes('SELECT id, label, created_at, expires_at, revoked_at, redeemed_at FROM invite_codes')) {
  addError("server.js", "Invite list responses must return metadata only, never code hashes or codes.");
}
if (!serverSource.includes('WHERE id = $1 AND revoked_at IS NULL AND redeemed_at IS NULL')) {
  addError("server.js", "A redeemed invite must never be revocable and a revoked invite must never be revoked twice.");
}
if (!serverSource.includes('CREATE TABLE IF NOT EXISTS invite_codes') ||
    !serverSource.includes('code_hash TEXT NOT NULL UNIQUE')) {
  addError("server.js", "invite_codes must exist with a unique code_hash column so codes are never stored in plaintext.");
}
if (/code_hash/.test(staffSource)) {
  addError("staff.js", "The invite UI must never receive or render code hashes.");
}
if (!/inviteResultPanel/.test(staffSource) || !/staff-invite-code/.test(staffSource) ||
    !/shown only once/i.test(staffSource)) {
  addError("staff.js", "The invite generator must surface one-time codes in a dedicated result panel that warns the code is shown only once.");
}

// Applicant age: registration asks for it, storage keeps the consent flag, the public feed gates it, and staff can edit both.
if (!serverSource.includes("(CASE WHEN show_age_on_profile THEN age ELSE NULL END) AS age")) {
  addError("server.js", "Public roster queries must gate the age behind the player's consent; a private age must never leave the database.");
}
if (!serverSource.includes("showAgeOnProfile") || !serverSource.includes("show_age_on_profile") ||
    !serverSource.includes('error: "Enter your age as a whole number (13 or older)."')) {
  addError("server.js", "Registration must require the applicant age and store the public-age consent flag.");
}
if (!serverSource.includes("INSERT INTO roster_players (display_name, email, game, platform, age, show_age_on_profile, member_type, social_links, source_application_id)")) {
  addError("server.js", "Accepting an applicant must copy their age and age-visibility consent onto the roster record.");
}
if (!serverSource.includes("UPDATE roster_players SET display_name=$1, game=$2, platform=$3, role=$4, bio=$5, social_url=$6, social_links=$7, highlight_url=$8, profile_image_url=$9, age=$10, show_age_on_profile=$11")) {
  addError("server.js", "Staff profile edits must be able to update the recorded age and its public visibility.");
}
const recruitmentClientSource = fs.readFileSync(path.join(root, "recruitment.js"), "utf8");
if (!recruitmentClientSource.includes("form.elements.age.value") || !recruitmentClientSource.includes("showAgeOnProfile")) {
  addError("recruitment.js", "The application payload must include the applicant age and the public-age consent.");
}
const playerClientSource = fs.readFileSync(path.join(root, "player.js"), "utf8");
if (!playerClientSource.includes("player.age != null") || !playerClientSource.includes('\"Age \" + player.age')) {
  addError("player.js", "Public player profiles must render the age only when the API returns a consented, non-null value.");
}
if (!staffSource.includes("editForm.elements.showAgeOnProfile") || !staffSource.includes("show_age_on_profile")) {
  addError("staff.js", "Staff profile editing must include the player's age and a public-visibility toggle.");
}

// Member accounts: passwords are scrypt-hashed in the backend only; sessions are stored as SHA-256 hashes.
if (!serverSource.includes("crypto.scryptSync(String(password)") ||
    !serverSource.includes("crypto.timingSafeEqual(hash, Buffer.from(hashHex, \"hex\"))")) {
  addError("server.js", "Member passwords must be hashed with scrypt and compared with a timing-safe function.");
}
if (!serverSource.includes("password_hash TEXT NOT NULL") || /SELECT[^;]*password_hash[^;]*--.public/.test(serverSource)) {
  addError("server.js", "The accounts schema must never expose password hashes outside the login/register paths.");
}
if (!serverSource.includes("token_hash TEXT PRIMARY KEY") || !serverSource.includes("sha256Hex(match[1])")) {
  addError("server.js", "Member sessions must be stored only as SHA-256 token hashes.");
}
if (!serverSource.includes("LOWER(display_name) = LOWER($1)")) {
  addError("server.js", "Member sign-in must match the player name case-insensitively.");
}
const accountsRegisterRoute = serverSource.match(/app\.post\(["']\/api\/accounts\/register["'][\s\S]*?(?=\napp\.)/);
if (!accountsRegisterRoute || !/bound_roster_id/.test(accountsRegisterRoute[0]) ||
    !/display_name\)\.toLowerCase\(\)/.test(accountsRegisterRoute[0])) {
  addError("server.js", "Invite redemption must be bound to a roster member and verify the application name.");
}
const accountsLoginRoute = serverSource.match(/app\.post\(["']\/api\/accounts\/login["'][\s\S]*?(?=\napp\.post\(["']\/api\/accounts\/logout|\napp\.get\(|\napp\.use\()/);
if (!accountsLoginRoute || !/verifyPassword\(password/.test(accountsLoginRoute[0])) {
  addError("server.js", "Member sign-in must verify the password through the hashed backend path.");
}
const meRoute = serverSource.match(/app\.get\(["']\/api\/me["'],\s*requireMemberSession/);
if (!meRoute) addError("server.js", "The member profile route must require an authenticated member session.");
if (!serverSource.includes("INSERT INTO roster_players (display_name, email, game, platform, age, show_age_on_profile, member_type, social_links, source_application_id)")) {
  addError("server.js", "Accepting media team or player applicants must carry their track and social links onto the roster record.");
}
const rosterClientSource = fs.readFileSync(path.join(root, "roster.js"), "utf8");
if (!rosterClientSource.includes('member_type === "media"')) {
  addError("roster.js", "Roster grouping must recognize media team members.");
}
if (!rosterClientSource.includes("isMediaTeam")) {
  addError("roster.js", "The public roster must render a separate media team section.");
}
if (!rosterClientSource.includes("memberSocialLinks(player)")) {
  addError("roster.js", "Roster cards must render the member's validated social links.");
}
const memberClientSource = fs.readFileSync(path.join(root, "auth.js"), "utf8");
if (!memberClientSource.includes("sessionStorage.setItem(SESSION_KEY, token)") ||
    memberClientSource.includes("localStorage")) {
  addError("auth.js", "Member sessions must live in sessionStorage only.");
}
const memberPage = fs.readFileSync(path.join(root, "member.html"), "utf8");
if (!memberPage.includes('id="memberRegisterForm"') || !memberPage.includes('id="memberLoginForm"') ||
    !memberPage.includes("salted scrypt hash")) {
  addError("member.html", "The member portal must offer both invite redemption and sign-in and disclose the hashing policy.");
}

if (!/content_type='result' AND published=TRUE AND verified=TRUE AND source_url IS NOT NULL/.test(serverSource) ||
    !/SELECT id, content_type, verified, title/.test(serverSource)) {
  addError("server.js", "Public match results must remain published, explicitly verified, and backed by a source link.");
}
if (!/content_type='media' AND published=TRUE AND \(source_url IS NOT NULL OR image_url IS NOT NULL\)/.test(serverSource) ||
    !/type === "media" && published && !sourceUrl && !imageUrl/.test(serverSource)) {
  addError("server.js", "Published media must include a source URL or an image asset.");
}
const contentClientSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
if (!contentClientSource.includes('/^\\d{4}-\\d{2}-\\d{2}$/')) {
  addError("content.js", "Date-only values must be parsed as local calendar dates to avoid timezone day shifts.");
}
if (!/Object\.prototype\.hasOwnProperty\.call\(item, "verified"\)/.test(contentClientSource) ||
    !/item\.verified === true/.test(contentClientSource) ||
    !/Boolean\(safeHttpsUrl\(item\.source_url\)\)/.test(contentClientSource) ||
    !/Verified result/i.test(contentClientSource)) {
  addError("content.js", "The public results client must reject explicit unverified flags and require a usable HTTPS evidence link.");
}
if (!/safeHttpsUrl\(item\.source_url\) \|\| safeHttpsUrl\(item\.image_url\)/.test(contentClientSource) ||
    !/content-card__source-note/.test(contentClientSource)) {
  addError("content.js", "The public media feed must contain a usable linked source or image asset and make provenance clear.");
}
if (!/External source link provided\./.test(contentClientSource) || !/No external source link provided\./.test(contentClientSource)) {
  addError("content.js", "News cards must distinguish sourced posts from posts with no external source link.");
}

for (const file of htmlFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const ids = new Set();
  const duplicateIds = new Set();
  for (const match of source.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    const id = match[1];
    if (ids.has(id)) duplicateIds.add(id);
    ids.add(id);
  }
  for (const id of duplicateIds) addError(file, "duplicate id #" + id);

  const ariaPattern = /\baria-(?:labelledby|describedby|controls)\s*=\s*["']([^"']+)["']/gi;
  for (const match of source.matchAll(ariaPattern)) {
    for (const id of match[1].trim().split(/\s+/)) {
      if (id && !ids.has(id)) addError(file, "ARIA reference points to missing id #" + id);
    }
  }

  const pageUrl = new URL(file, previewOrigin + siteBasePath);
  for (const match of source.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1].trim();
    if (!raw || /^(?:mailto:|tel:|data:|javascript:|blob:)/i.test(raw)) continue;
    let target;
    try { target = new URL(raw, pageUrl); } catch { continue; }

    const rawPath = raw.split(/[?#]/, 1)[0].toLowerCase();
    const explicitlyTargetsResultsPage = rawPath === "results.html" || rawPath.endsWith("/results.html");
    if (target.origin === previewOrigin && target.pathname.startsWith(legacyProjectPrefix)) {
      addError(file, "Legacy project-site URL detected; use the root GitHub Pages URL instead: " + raw);
      continue;
    }

    const isExternalProjectPage = target.origin === previewOrigin &&
      externalProjectPrefixes.some((prefix) => target.pathname.startsWith(prefix));
    if (explicitlyTargetsResultsPage && target.origin === previewOrigin &&
        target.pathname === siteBasePath + "results.html" &&
        /^[a-z][a-z0-9+.-]*:/i.test(raw) &&
        raw !== "https://nappygorilla.github.io/VAYNTR-eSports/results.html") {
      addError(file, "Results links must use a relative URL or the configured root GitHub Pages URL.");
    }

    const isSameSitePage = target.origin === previewOrigin && !isExternalProjectPage;
    if (!isSameSitePage) continue;

    let relative = target.pathname.slice(siteBasePath.length);
    if (!relative || relative.endsWith("/")) relative += "index.html";
    relative = decodeURIComponent(relative);
    const destination = path.resolve(root, relative);
    if (!destination.startsWith(root + path.sep) && destination !== path.join(root, "index.html")) {
      addError(file, "local URL escapes site directory: " + raw);
      continue;
    }
    if (!fs.existsSync(destination) || !fs.statSync(destination).isFile()) {
      addError(file, "missing local target: " + raw);
      continue;
    }

    if (target.hash && destination.endsWith(".html")) {
      const targetHtml = fs.readFileSync(destination, "utf8");
      const targetIds = new Set([...targetHtml.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((item) => item[1]));
      let hash = target.hash.slice(1);
      try { hash = decodeURIComponent(hash); } catch {}
      if (hash && !targetIds.has(hash)) addError(file, "missing anchor '" + raw + "' (no id #" + hash + " in " + path.basename(destination) + ")");
    }
  }
}

if (errors.length) {
  console.error("Site integrity checks failed:");
  for (const error of errors) console.error(" - " + error);
  process.exitCode = 1;
} else {
  console.log("Site integrity checks passed (" + htmlFiles.length + " HTML pages checked).");
}
