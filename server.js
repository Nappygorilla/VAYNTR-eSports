"use strict";

const express = require("express");
const crypto = require("node:crypto");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || "https://nappygorilla.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || "";
// Trim whitespace and wrapping quotes: browsers strip them from the Authorization header, so a stray
// space/newline saved in the Render dashboard would otherwise make a correct key look wrong.
const STAFF_REVIEW_TOKEN = (process.env.STAFF_REVIEW_TOKEN || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();

const DIVISIONS = ["Call of Duty: Warzone", "Call of Duty Multiplayer", "Rocket League", "Other / future division"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function parseOptionalHttpsUrl(value) {
  if (value == null || String(value).trim() === "") return null;
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch { return undefined; }
}

// Age is optional on the roster but required on applications. null = not provided/hidden.
function parseOptionalAge(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 13 && parsed <= 120 ? parsed : undefined;
}

// Member avatars live in the database (Render's filesystem is ephemeral) and are served
// from a dedicated GET endpoint; uploads are validated by magic bytes and capped at 300 KB.
const MAX_AVATAR_BYTES = 300 * 1024;
function detectImageContentType(bytes) {
  if (!bytes || !Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// --- Member accounts (passwords are hashed with scrypt and never leave the backend) ---
const SESSION_TTL_DAYS = 7;
const MAX_SOCIAL_LINKS = 3;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return salt.toString("hex") + ":" + hash.toString("hex");
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || "").split(":");
  if (!saltHex || !hashHex || hashHex.length !== 128) return false;
  try {
    const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
  } catch {
    return false;
  }
}

function createSessionToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: sha256Hex(token) };
}

// Application social links arrive as socialUrl1..socialUrl3; media applicants must include at least one.
function parseApplicationSocialLinks(body) {
  return [body.socialUrl1, body.socialUrl2, body.socialUrl3].map((url) => parseOptionalHttpsUrl(url));
}

// Staff editor sends social links as a newline-separated string; each entry must be HTTPS.
function parseSocialLinksInput(value, maxLinks) {
  if (typeof value !== "string") return [];
  const entries = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, maxLinks || MAX_SOCIAL_LINKS);
  return entries.map((entry) => {
    const parsed = parseOptionalHttpsUrl(entry);
    return parsed === null || parsed === undefined ? parsed : { label: "", url: parsed };
  });
}

function isValidSocialLinksArray(value) {
  if (!Array.isArray(value) || value.length > MAX_SOCIAL_LINKS) return false;
  return value.every((link) => link && typeof link === "object"
    && typeof link.url === "string" && safePublicHttpsUrl(link.url)
    && (link.label == null || (typeof link.label === "string" && link.label.length <= 40)));
}

// Returns the canonical HTTPS url string or null; used to validate data before it is stored or published.
function safePublicHttpsUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch { return null; }
}

function isStrongPassword(password) {
  return typeof password === "string" && password.length >= 10 && password.length <= 128
    && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

// Hardened password policy: 12+ characters, all four character classes, and common passwords rejected.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "123456", "1234567", "12345678", "123456789", "1234567890",
  "qwerty", "qwerty123", "qwertyuiop", "abc123", "abc123456", "iloveyou", "iloveyou1", "admin",
  "admin123", "admin1234", "administrator", "welcome", "welcome1", "welcome123", "letmein",
  "letmein123", "monkey", "monkey123", "dragon", "dragon123", "sunshine", "sunshine1",
  "princess", "football", "baseball", "superman", "superman1", "batman", "batman123",
  "trustno1", "master", "master123", "passw0rd", "p@ssword", "p@ssw0rd", "pass1234", "pass12345",
  "abcd1234", "abcd12345", "a123456", "aa123456", "qwerty12", "1q2w3e4r", "1q2w3e4r5t",
  "1qaz2wsx", "qazwsx", "zxcvbnm", "asdfgh", "asdfghjkl", "iloveyou2", "pokemon", "pokemon123",
  "minecraft", "dragonball", "starwars", "ferrari", "liverpool", "chelsea", "arsenal",
  "vayntr", "vayntr123", "esports", "esports123", "gaming", "gamer123", "call of duty",
  "warzone", "warzone123", "rocketleague", "test123", "test1234", "sample123", "changeme",
  "secret", "secret123", "hunter2", "password1234", "p4ssw0rd", "qwerty1", "123qwe", "1234qwer"
]);

function isHardenedPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) return false;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return false;
  const lowered = password.toLowerCase();
  // Reject simple obfuscations of very common passwords (leetspeak and suffixes).
  const normalized = lowered.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/@/g, "a").replace(/\$/g, "s");
  for (const common of COMMON_PASSWORDS) {
    const normalizedCommon = common.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/@/g, "a").replace(/\$/g, "s");
    if (normalized.includes(normalizedCommon)) return false;
  }
  return true;
}

const STRONG_PASSWORD_MESSAGE = "Choose a password with at least 12 characters including an uppercase letter, a lowercase letter, a number, and a symbol. Avoid common passwords and name-based phrases.";

// --- TOTP multi-factor authentication (RFC 6238) ---------------------------
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const clean = String(text || "").replace(/[^A-Za-z2-7]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function totpCodeAt(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = ((hmac[offset] & 127) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
  return String(code).padStart(6, "0");
}

function verifyTotpCode(secretBase32, code) {
  const secret = base32Decode(secretBase32);
  if (secret.length < 10 || typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(Date.now() / 30000);
  const supplied = Buffer.from(code);
  for (let drift = -1; drift <= 1; drift++) {
    if (crypto.timingSafeEqual(Buffer.from(totpCodeAt(secret, counter + drift)), supplied)) return true;
  }
  return false;
}

// Secrets are AES-256-GCM encrypted at rest with a key derived from JWT_SECRET.
function mfaCipherKey() {
  return crypto.createHash("sha256").update(String(process.env.JWT_SECRET || "")).digest();
}

function encryptTotpSecret(plainSecret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", mfaCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainSecret), "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + cipher.getAuthTag().toString("hex") + ":" + encrypted.toString("hex");
}

function decryptTotpSecret(payload) {
  try {
    const [ivHex, tagHex, dataHex] = String(payload).split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", mfaCipherKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  } catch { return null; }
}

// --- Proof-of-Work challenge (hashcash) for repeated failed sign-ins ------
const POW_DIFFICULTY_BITS = 16;

function digestHasLeadingZeroBits(hexDigest, bits) {
  let zeroBits = 0;
  for (const nibbleChar of hexDigest) {
    const nibble = parseInt(nibbleChar, 16);
    if (nibble === 0) { zeroBits += 4; if (zeroBits >= bits) return true; continue; }
    zeroBits += Math.clz32(nibble) - 28;
    return zeroBits >= bits;
  }
  return true;
}

function meetsProofOfWork(salt, nonce, bits) {
  if (typeof nonce !== "string" || !/^\d{1,40}$/.test(nonce) || typeof salt !== "string" || salt.length > 64) return false;
  const digest = crypto.createHash("sha256").update(salt + ":" + nonce).digest("hex");
  return digestHasLeadingZeroBits(digest, bits);
}

function issuePowChallenge() {
  return { difficultyBits: POW_DIFFICULTY_BITS, salt: crypto.randomBytes(8).toString("hex") };
}

// Per-IP failed sign-in tracker for the PoW trigger (covers unknown names without leaking account existence).
const powFailuresByIp = new Map();
function noteIpFailure(ip) {
  const key = sha256Hex(String(ip || "unknown")).slice(0, 24);
  const now = Date.now();
  const recent = (powFailuresByIp.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  recent.push(now);
  powFailuresByIp.set(key, recent);
  if (powFailuresByIp.size > 5000) for (const [mapKey, times] of powFailuresByIp) { if (times.every((time) => now - time >= 15 * 60 * 1000)) powFailuresByIp.delete(mapKey); }
  return recent.length;
}

function securityLogger(poolRef, eventType, fields) {
  if (!poolRef) return;
  void poolRef.query(
    "INSERT INTO security_events (event_type, account_id, name_hint, ip_hash, detail) VALUES ($1, $2, $3, $4, $5)",
    [eventType, fields.accountId ?? null, fields.nameHint ? String(fields.nameHint).slice(0, 50) : null, fields.ip ? sha256Hex(String(fields.ip)).slice(0, 32) : null, fields.detail ? String(fields.detail).slice(0, 300) : null]
  ).catch(() => { /* security logging must never break the request path */ });
}

// Increment the failed sign-in counter and auto-lock after 5 consecutive failures.
// Repeated lockouts double the cooldown (5 → 10 → 20 → 40 → capped at 60 minutes).
const LOCKOUT_THRESHOLD = 5;
async function bumpFailedLogins(accountId) {
  const result = await pool.query(
    `WITH bumped AS (
       SELECT id, failed_login_count + 1 AS new_count, lockout_cycles AS old_cycles FROM accounts WHERE id = $1
     ), updated AS (
       UPDATE accounts a
       SET failed_login_count = CASE WHEN b.new_count >= $2 THEN 0 ELSE b.new_count END,
           lockout_cycles = CASE WHEN b.new_count >= $2 THEN b.old_cycles + 1 ELSE b.old_cycles END,
           lockout_until = CASE WHEN b.new_count >= $2 THEN NOW() + LEAST(INTERVAL '60 minutes', INTERVAL '5 minutes' * POWER(2, b.old_cycles)) ELSE a.lockout_until END
       FROM bumped b WHERE a.id = b.id
       RETURNING a.failed_login_count, a.lockout_until, a.lockout_cycles
     )
     SELECT * FROM updated`,
    [accountId, LOCKOUT_THRESHOLD]
  );
  return result.rows[0] || null;
}

function parseYouTubeVideoUrl(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  let outputUrl = "";
  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    outputUrl = "https://www.youtube.com/watch?v=" + videoId;
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") || "";
      outputUrl = "https://www.youtube.com/watch?v=" + videoId;
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && ["shorts", "embed", "live"].includes(parts[0])) {
        videoId = parts[1];
        outputUrl = "https://www.youtube.com/" + parts[0] + "/" + videoId;
      }
    }
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return outputUrl;
}

function emailHtml({ preheader, title, displayName, paragraphs, statusLabel }) {
  const paragraphHtml = paragraphs.map((paragraph) =>
    '<p style="margin:0 0 16px;color:#c7c9d0;font:15px/1.7 Arial,Helvetica,sans-serif;">' +
    escapeHtml(paragraph) + '</p>'
  ).join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
    '<body style="margin:0;padding:0;background:#08090b;color:#f4f5f7;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + escapeHtml(preheader) + '</div>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08090b;padding:30px 12px;">' +
    '<tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#101216;border:1px solid #2b2f37;">' +
    '<tr><td style="padding:28px 30px 22px;border-bottom:1px solid #2b2f37;">' +
    '<div style="font:900 28px/1 Arial,Helvetica,sans-serif;letter-spacing:5px;color:#fff;">VAYNTR<span style="color:#e32135;">.</span></div>' +
    '<div style="margin-top:9px;color:#ff6574;font:700 10px/1.5 Arial,Helvetica,sans-serif;letter-spacing:2px;">ESPORTS / RECRUITMENT DIVISION</div>' +
    '</td></tr><tr><td style="padding:30px;">' +
    '<div style="font:800 10px/1.5 Arial,Helvetica,sans-serif;letter-spacing:2px;color:#ff6574;text-transform:uppercase;">Official recruitment communication</div>' +
    '<h1 style="margin:12px 0 20px;color:#fff;font:900 30px/1.1 Arial,Helvetica,sans-serif;letter-spacing:-.5px;">' + escapeHtml(title) + '</h1>' +
    '<p style="margin:0 0 16px;color:#f4f5f7;font:15px/1.7 Arial,Helvetica,sans-serif;">Hi ' + escapeHtml(displayName) + ',</p>' +
    paragraphHtml +
    (statusLabel ? '<div style="margin:24px 0;padding:16px 18px;border:1px solid #393d45;background:#17191e;"><div style="color:#9ba1ab;font:700 10px/1.4 Arial,Helvetica,sans-serif;letter-spacing:2px;">APPLICATION STATUS</div><div style="margin-top:7px;color:#ff6574;font:800 14px/1.5 Arial,Helvetica,sans-serif;letter-spacing:1px;">' + escapeHtml(statusLabel) + '</div></div>' : '') +
    '<div style="margin-top:26px;padding-top:18px;border-top:1px solid #2b2f37;color:#7e8590;font:11px/1.7 Arial,Helvetica,sans-serif;">This email was sent by the VAYNTR Esports recruitment system. If you did not submit an application, you can ignore this message.</div>' +
    '</td></tr><tr><td style="padding:16px 30px;background:#0b0d10;color:#727984;font:10px/1.6 Arial,Helvetica,sans-serif;letter-spacing:1px;">VAYNTR ESPORTS · BUILT TO COMPETE. MADE TO ENDURE.</td></tr>' +
    '</table></td></tr></table></body></html>';
}

async function sendVayntrEmail({ to, subject, title, displayName, paragraphs, preheader, statusLabel }) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    console.warn("VAYNTR email notification skipped: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
    return { sent: false, reason: "email_not_configured" };
  }
  try {
    const message = {
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html: emailHtml({ preheader, title, displayName, paragraphs, statusLabel }),
      text: [title, "", "Hi " + displayName + ",", "", ...paragraphs, "", statusLabel ? "APPLICATION STATUS: " + statusLabel : "", "", "VAYNTR Esports"].filter(Boolean).join("\n")
    };
    if (RESEND_REPLY_TO) message.reply_to = RESEND_REPLY_TO;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      console.error("Resend rejected a VAYNTR email. HTTP status:", response.status);
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true, reason: "accepted_by_provider" };
  } catch (error) {
    console.error("VAYNTR email request failed:", error.name || "UnknownError");
    return { sent: false, reason: "provider_unavailable" };
  }
}

async function sendApplicationReceivedEmail(application) {
  return sendVayntrEmail({
    to: application.email,
    subject: "VAYNTR Esports | Application Received",
    title: "APPLICATION RECEIVED",
    displayName: application.display_name,
    preheader: "Your VAYNTR Esports recruitment application has been received.",
    statusLabel: "UNDER REVIEW",
    paragraphs: [
      "Thank you for applying to VAYNTR Esports. We have received your application and YouTube video link.",
      "Our recruitment team will review your submission. Submitting an application does not guarantee acceptance. If email notifications are available, we will send a separate notice when a decision is recorded."
    ]
  });
}

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === "true" },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}) : null;

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || FRONTEND_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "20kb" }));
const recruitmentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many applications from this connection. Please wait and try again." } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many requests. Please wait a few minutes and try again." }, skip: (req) => req.path.startsWith("/staff") });
const healthLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
// Count unsuccessful staff requests only. Successful staff dashboard calls do not consume this budget.
const staffAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many unsuccessful staff access attempts. Please wait before trying again." }
});
app.use("/api", apiLimiter);
app.use("/api/staff", staffAuthLimiter);
const accountsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many account attempts. Please wait a few minutes and try again." } });
// Successful member logins do not consume the failed-login budget.
const loginFailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, skipSuccessfulRequests: true, message: { error: "Too many unsuccessful sign-in attempts. Please wait 15 minutes and try again." } });
app.use("/api/accounts", accountsLimiter);

function requireDatabase(_req, res, next) {
  if (!pool) return res.status(503).json({ error: "Database is not configured yet." });
  next();
}
function requireStaffAccess(req, res, next) {
  // Staff endpoints contain private applicant and roster details; prevent shared/browser HTTP caching.
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  if (STAFF_REVIEW_TOKEN.length < 32) {
    return res.status(503).json({ error: "Staff review access is not configured." });
  }
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "A staff review token is required." });

  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(STAFF_REVIEW_TOKEN);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: "The staff review token is invalid." });
  }

  req.user = { id: null, display_name: "VAYNTR staff token", role: "admin" };
  return next();
}

async function requireMemberSession(req, res, next) {
  res.set("Cache-Control", "no-store, private");
  if (!pool) return res.status(503).json({ error: "Member accounts are not available yet." });
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Sign in to view your member profile." });
  try {
    const result = await pool.query(
      "SELECT a.id AS account_id, a.roster_id, a.created_at AS member_since, a.mfa_enabled, r.display_name, r.member_type, r.game, r.platform, r.role, r.bio, r.social_links, r.profile_image_url, r.social_url, r.age, r.show_age_on_profile, (r.avatar_data IS NOT NULL) AS has_avatar FROM account_sessions s JOIN accounts a ON a.id = s.account_id JOIN roster_players r ON r.id = a.roster_id WHERE s.token_hash = $1 AND s.expires_at > NOW()",
      [sha256Hex(match[1])]
    );
    if (!result.rowCount) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    req.member = result.rows[0];
    return next();
  } catch (error) { return next(error); }
}

function memberProfilePayload(member) {
  return {
    id: member.roster_id,
    displayName: member.display_name,
    memberType: member.member_type || "player",
    game: member.game || "",
    platform: member.platform || "",
    role: member.role || "",
    bio: member.bio || "",
    socialLinks: Array.isArray(member.social_links) ? member.social_links : [],
    age: member.age,
    showAgeOnProfile: member.show_age_on_profile === true,
    mfaEnabled: member.mfa_enabled === true,
    hasAvatar: member.has_avatar === true,
    memberSince: member.member_since
  };
}

app.get("/health", healthLimiter, async (_req, res) => {
  // Health/status probes must never be served from a stale cache by browsers or proxies.
  res.set("Cache-Control", "no-store");
  let database = "not_configured";
  if (pool) {
    try { await pool.query("SELECT 1"); database = "connected"; }
    catch { database = "unavailable"; }
  }
  res.status(database === "unavailable" ? 503 : 200).json({ ok: database !== "unavailable", service: "vayntr-api", database, time: new Date().toISOString() });
});
app.get("/api/status", async (_req, res) => {
  // The recruitment page probes this endpoint to enable the form; keep it uncached so availability is always current.
  res.set("Cache-Control", "no-store");
  let databaseReady = false;
  if (pool) {
    try { await pool.query("SELECT 1"); databaseReady = true; }
    catch { databaseReady = false; }
  }
  res.json({
    service: "VAYNTR API",
    status: "online",
    features: {
      health: true,
      accounts: databaseReady,
      recruitmentApplications: databaseReady,
      staffTools: databaseReady,
      emailNotifications: Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL),
      staffReviewConfigured: STAFF_REVIEW_TOKEN.length >= 32
    }
  });
});

app.get("/api/roster", requireDatabase, async (_req, res, next) => {
  try {
    // Only fields needed by public cards/profiles leave this route. Contact emails and internal timestamps stay private.
    const result = await pool.query(
      // The age is published only when the player consented to showing it; otherwise it leaves the database as NULL.
      "SELECT id, display_name, game, platform, role, bio, social_url, social_links, highlight_url, profile_image_url, (CASE WHEN show_age_on_profile THEN age ELSE NULL END) AS age, member_type, (avatar_data IS NOT NULL) AS has_avatar FROM roster_players ORDER BY game ASC, display_name ASC"
    );
    res.set("Cache-Control", "no-store");
    res.json({ players: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/recruitment/applications", recruitmentLimiter, requireDatabase, async (req, res, next) => {
  if (STAFF_REVIEW_TOKEN.length < 32) {
    return res.status(503).json({ error: "Recruitment applications are temporarily paused while secure staff review is configured." });
  }
  try {
    const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const platform = typeof req.body.platform === "string" ? req.body.platform.trim() : "";
    const game = typeof req.body.game === "string" ? req.body.game.trim() : "";
    const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
    const youtubeUrl = parseYouTubeVideoUrl(req.body.youtubeUrl);
    const privacyConsent = req.body.privacyConsent === true;
    const ageConfirmed = req.body.ageConfirmed === true;
    const age = parseOptionalAge(req.body.age);
    const showAgeOnProfile = req.body.showAgeOnProfile === true;
    const track = req.body.track === "media" ? "media" : "player";
    const socialLinksRaw = parseApplicationSocialLinks(req.body);
    const socialLinks = socialLinksRaw
      .map((url) => (url && url !== undefined ? { label: "", url } : url));

    if (displayName.length < 2 || displayName.length > 50) return res.status(400).json({ error: "Display name must be 2–50 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (!["PlayStation", "Xbox", "PC", "Cross-platform"].includes(platform)) return res.status(400).json({ error: "Choose a valid platform." });
    if (!DIVISIONS.includes(game)) {
      // Media team applicants may leave the division blank; players must choose one.
      if (!(track === "media" && game === "")) return res.status(400).json({ error: "Choose a valid game or division." });
    }
    if (!youtubeUrl && track === "player") return res.status(400).json({ error: "Submit a valid YouTube video link, not a channel or playlist link." });
    if (!ageConfirmed) return res.status(400).json({ error: "Confirm the age and parent/guardian statement before submitting." });
    if (!privacyConsent) return res.status(400).json({ error: "Confirm the application privacy acknowledgement before submitting." });
    if (!Number.isSafeInteger(age)) return res.status(400).json({ error: "Enter your age as a whole number (13 or older)." });
    if (message.length > 2000) return res.status(400).json({ error: "Additional information must be 2,000 characters or fewer." });
    if (socialLinks.some((link) => link === undefined)) return res.status(400).json({ error: "Social links must be valid HTTPS URLs." });
    if (track === "media" && socialLinks.every((link) => link === null)) {
      return res.status(400).json({ error: "Media team applicants must include at least one social media link so we can review your work." });
    }
    const storedSocialLinks = socialLinks.filter((link) => link !== null);

    const result = await pool.query(
      "INSERT INTO recruitment_applications (display_name, email, platform, game, message, youtube_url, privacy_consent, age, show_age_on_profile, track, social_links, privacy_consent_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING id, status, created_at",
      [displayName, email, platform, game, message, youtubeUrl, privacyConsent, age, showAgeOnProfile, track, JSON.stringify(storedSocialLinks)]
    );
    const application = { ...result.rows[0], display_name: displayName, email };
    // VAYNTR is using manual applicant contact for now; never send a confirmation email automatically.
    await pool.query(
      "UPDATE recruitment_applications SET confirmation_email_status = 'manual_contact', confirmation_email_sent_at = NULL WHERE id = $1",
      [application.id]
    );

    res.status(201).json({
      application: result.rows[0],
      notification: { sent: false, reason: "manual_contact" },
      message: "Application received. VAYNTR will review it and contact you by email manually."
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/staff/applications", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, display_name, email, platform, game, message, youtube_url, age, show_age_on_profile, track, social_links, status, created_at, confirmation_email_status, decision_notified_status, decision_email_error FROM recruitment_applications ORDER BY created_at DESC LIMIT 100");
    res.json({ applications: result.rows });
  } catch (error) { next(error); }
});
app.get("/api/staff/roster", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    // Email is exposed only inside this authenticated staff endpoint so the operator can contact players manually.
    const result = await pool.query(
      "SELECT id, display_name, email, game, platform, role, bio, social_url, social_links, highlight_url, profile_image_url, age, show_age_on_profile, member_type, (avatar_data IS NOT NULL) AS has_avatar, accepted_at FROM roster_players ORDER BY accepted_at DESC"
    );
    res.json({ players: result.rows });
  } catch (error) { next(error); }
});


// Public feeds return published items only. Match results also require staff verification.
app.get("/api/news", requireDatabase, async (_req, res, next) => {
  try {
    // played_at is returned as YYYY-MM-DD text instead of a UTC-midnight timestamp so
    // the date is rendered identically for every visitor time zone.
    const result = await pool.query("SELECT id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, to_char(played_at, 'YYYY-MM-DD') AS played_at, source_url, image_url, created_at, updated_at FROM site_content WHERE content_type='news' AND published=TRUE ORDER BY created_at DESC LIMIT 50");
    res.set("Cache-Control", "no-store"); res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.get("/api/results", requireDatabase, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, content_type, verified, title, category, excerpt, body, game, event_name, opponent, score, outcome, to_char(played_at, 'YYYY-MM-DD') AS played_at, source_url, image_url, created_at, updated_at FROM site_content WHERE content_type='result' AND published=TRUE AND verified=TRUE AND source_url IS NOT NULL ORDER BY site_content.played_at DESC NULLS LAST, created_at DESC LIMIT 100");
    res.set("Cache-Control", "no-store"); res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.get("/api/media", requireDatabase, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, to_char(played_at, 'YYYY-MM-DD') AS played_at, source_url, image_url, created_at, updated_at FROM site_content WHERE content_type='media' AND published=TRUE AND (source_url IS NOT NULL OR image_url IS NOT NULL) ORDER BY created_at DESC LIMIT 100");
    res.set("Cache-Control", "no-store"); res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/staff/roster/:id/update", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const id = Number(req.params.id);
  const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
  const game = typeof req.body.game === "string" ? req.body.game.trim() : "";
  const platform = typeof req.body.platform === "string" ? req.body.platform.trim() : "";
  const role = typeof req.body.role === "string" ? req.body.role.trim() : "Player";
  const age = parseOptionalAge(req.body.age);
  const showAgeOnProfile = req.body.showAgeOnProfile === true;
  const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
  const socialLinks = parseSocialLinksInput(req.body.socialLinks, MAX_SOCIAL_LINKS);
  const legacySocialUrl = socialLinks.length ? socialLinks[0].url : null;
  const highlightUrl = parseOptionalHttpsUrl(req.body.highlightUrl);
  const profileImageUrl = parseOptionalHttpsUrl(req.body.profileImageUrl);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid roster player ID." });
  if (displayName.length < 2 || displayName.length > 50) return res.status(400).json({ error: "Display name must be 2–50 characters." });
  if (game.length < 2 || game.length > 80) return res.status(400).json({ error: "Game/division must be 2–80 characters." });
  if (!["PlayStation", "Xbox", "PC", "Cross-platform"].includes(platform)) return res.status(400).json({ error: "Choose a valid platform." });
  if (role.length < 2 || role.length > 60 || bio.length > 500) return res.status(400).json({ error: "Role must be 2–60 characters and bio 500 characters or fewer." });
  if (socialLinks.some((link) => link === null || link === undefined)) return res.status(400).json({ error: "Social links must be valid HTTPS URLs. Put one link per line (up to 3)." });
  if ([legacySocialUrl, highlightUrl, profileImageUrl].some((url) => url === undefined)) return res.status(400).json({ error: "Profile, highlight, and image links must be valid HTTPS URLs." });
  if (age === undefined) return res.status(400).json({ error: "Age must be a whole number between 13 and 120, or leave it blank to keep it private." });
  try {
    const result = await pool.query(
      "UPDATE roster_players SET display_name=$1, game=$2, platform=$3, role=$4, bio=$5, social_url=$6, social_links=$7, highlight_url=$8, profile_image_url=$9, age=$10, show_age_on_profile=$11 WHERE id=$12 RETURNING id, display_name, game, platform, role, bio, social_url, social_links, highlight_url, profile_image_url, age, show_age_on_profile, member_type, accepted_at",
      [displayName, game, platform, role, bio, legacySocialUrl, JSON.stringify(socialLinks), highlightUrl, profileImageUrl, age, showAgeOnProfile, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "This roster player no longer exists. Refresh the roster." });
    // Keep the member sign-in name in sync when staff rename the player.
    await pool.query("UPDATE accounts SET display_name = $1 WHERE roster_id = $2", [displayName, id]);
    res.json({ player: result.rows[0], message: "Player profile updated." });
  } catch (error) { next(error); }
});

app.get("/api/staff/content", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, to_char(played_at, 'YYYY-MM-DD') AS played_at, source_url, image_url, published, verified, created_at, updated_at FROM site_content ORDER BY updated_at DESC LIMIT 200");
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.post("/api/staff/content", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const type = req.body.type;
  const id = req.body.id == null || req.body.id === "" ? null : Number(req.body.id);
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const category = typeof req.body.category === "string" ? req.body.category.trim() : "";
  const excerpt = typeof req.body.excerpt === "string" ? req.body.excerpt.trim() : "";
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
  const game = typeof req.body.game === "string" ? req.body.game.trim() : "";
  const eventName = typeof req.body.eventName === "string" ? req.body.eventName.trim() : "";
  const opponent = typeof req.body.opponent === "string" ? req.body.opponent.trim() : "";
  const score = typeof req.body.score === "string" ? req.body.score.trim() : "";
  const outcome = typeof req.body.outcome === "string" ? req.body.outcome.trim() : "";
  const playedAt = typeof req.body.playedAt === "string" && req.body.playedAt.trim() ? req.body.playedAt.trim() : null;
  const sourceUrl = parseOptionalHttpsUrl(req.body.sourceUrl);
  const imageUrl = parseOptionalHttpsUrl(req.body.imageUrl);
  const published = req.body.published === true;
  const verified = req.body.verified === true;
  if (!["news", "result", "media"].includes(type)) return res.status(400).json({ error: "Choose news, results, or media content." });
  if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return res.status(400).json({ error: "Invalid content ID." });
  if (title.length < 3 || title.length > 140) return res.status(400).json({ error: "Title must be 3–140 characters." });
  if (category.length > 80 || excerpt.length > 600 || body.length > 10000) return res.status(400).json({ error: "Category, summary, or body is too long." });
  if (game.length > 80 || eventName.length > 140 || opponent.length > 120 || score.length > 60 || outcome.length > 40) return res.status(400).json({ error: "One or more match fields are too long." });
  if (playedAt && !/^\d{4}-\d{2}-\d{2}$/.test(playedAt)) return res.status(400).json({ error: "Match date must use YYYY-MM-DD." });
  if (type === "result" && (!game || !eventName)) return res.status(400).json({ error: "A result needs both the game/division and event name." });
  if (type === "result" && published && !sourceUrl) return res.status(400).json({ error: "A published result needs a source or evidence link. Save it as a draft until the link is available." });
  if (type === "media" && published && !sourceUrl && !imageUrl) return res.status(400).json({ error: "Published media needs a source link or image asset. Save it as a draft until one is available." });
  if ([sourceUrl, imageUrl].some((url) => url === undefined)) return res.status(400).json({ error: "Source and image links must be valid HTTPS URLs." });
  const values = [type, title, category || (type === "result" ? "Match result" : type === "media" ? "Media" : "Announcement"), excerpt, body, game, eventName, opponent, score, outcome, playedAt, sourceUrl, imageUrl, published, verified];
  try {
    let result;
    if (id !== null) {
      result = await pool.query(
        "UPDATE site_content SET content_type=$1, title=$2, category=$3, excerpt=$4, body=$5, game=$6, event_name=$7, opponent=$8, score=$9, outcome=$10, played_at=$11, source_url=$12, image_url=$13, published=$14, verified=$15, updated_at=NOW() WHERE id=$16 RETURNING id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, to_char(played_at, 'YYYY-MM-DD') AS played_at, source_url, image_url, published, verified, created_at, updated_at",
        [...values, id]
      );
      if (!result.rowCount) return res.status(404).json({ error: "Content item not found. Refresh the content desk." });
    } else {
      result = await pool.query(
        "INSERT INTO site_content (content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, played_at, source_url, image_url, published, verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, to_char(played_at, 'YYYY-MM-DD') AS played_at, source_url, image_url, published, verified, created_at, updated_at",
        values
      );
    }
    res.status(id === null ? 201 : 200).json({ item: result.rows[0], message: id === null ? "Content created." : "Content updated." });
  } catch (error) { next(error); }
});
app.post("/api/staff/content/delete", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const id = Number(req.body.id);
  const type = req.body.type;
  if (!Number.isSafeInteger(id) || id < 1 || !["news", "result", "media"].includes(type)) return res.status(400).json({ error: "Invalid content type or ID." });
  try {
    const result = await pool.query("DELETE FROM site_content WHERE id=$1 AND content_type=$2 RETURNING id", [id, type]);
    if (!result.rowCount) return res.status(404).json({ error: "Content item not found." });
    res.json({ deleted: true, message: "Content deleted." });
  } catch (error) { next(error); }
});

// --- Member invites (one-time codes) --------------------------------------
// Codes exist for accepted players; redemption binds them to a future member
// account. Codes are shown exactly once by POST /api/staff/invites; the
// database stores only a SHA-256 hash, never the code itself.
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 32 glyphs, no I/L/O/0/1 lookalikes
const MAX_LIVE_INVITES = 50;

function hashInviteCode(code) {
  return crypto.createHash("sha256").update(String(code || "").trim().toUpperCase()).digest("hex");
}

function generateInviteCode() {
  // crypto.randomBytes(5) maps evenly onto 32 glyphs because 256 = 8 * 32, so there is no modulo bias.
  const segment = () => Array.from(crypto.randomBytes(5), (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join("");
  return "VAYNTR-" + segment() + "-" + segment() + "-" + segment();
}

app.post("/api/staff/invites", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
  if (label.length > 120) return res.status(400).json({ error: "The invite note must be 120 characters or fewer." });
  try {
    const live = await pool.query(
      "SELECT COUNT(*)::int AS count FROM invite_codes WHERE revoked_at IS NULL AND redeemed_at IS NULL AND expires_at > NOW()"
    );
    if (live.rows[0].count >= MAX_LIVE_INVITES) {
      return res.status(409).json({ error: "There are already 50 unused invites. Revoke old ones before generating more." });
    }
    const code = generateInviteCode();
    const result = await pool.query(
      "INSERT INTO invite_codes (label, code_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days') RETURNING id, label, created_at, expires_at",
      [label, hashInviteCode(code)]
    );
    // The plaintext code is returned only here. It is not stored or logged anywhere.
    res.set("Cache-Control", "no-store, private");
    res.status(201).json({ invite: result.rows[0], code, message: "Invite created. This code is shown only once — copy it now." });
  } catch (error) { next(error); }
});

app.get("/api/staff/invites", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    // Lists carry metadata only: never the hash and obviously never the plaintext code.
    const result = await pool.query(
      "SELECT id, label, created_at, expires_at, revoked_at, redeemed_at FROM invite_codes ORDER BY created_at DESC LIMIT 100"
    );
    res.set("Cache-Control", "no-store, private");
    res.json({ invites: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/staff/invites/:id/revoke", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid invite ID." });
  try {
    const result = await pool.query(
      "UPDATE invite_codes SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL AND redeemed_at IS NULL RETURNING id, label",
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Invite not found, already revoked, or already redeemed." });
    res.json({ revoked: true, message: "Invite revoked. It can no longer be redeemed." });
  } catch (error) { next(error); }
});

// Issue an invite bound to one roster member: only that person (verified by their
// application/roster name during redemption) can create the account with this code.
app.post("/api/staff/invites/for-roster/:rosterId", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const rosterId = Number(req.params.rosterId);
  if (!Number.isSafeInteger(rosterId) || rosterId < 1) return res.status(400).json({ error: "Invalid roster player ID." });
  try {
    const player = await pool.query("SELECT id, display_name, member_type FROM roster_players WHERE id = $1", [rosterId]);
    if (!player.rowCount) return res.status(404).json({ error: "This roster player no longer exists. Refresh the roster." });
    const alreadyAccounted = await pool.query("SELECT id FROM accounts WHERE roster_id = $1", [rosterId]);
    if (alreadyAccounted.rowCount) return res.status(409).json({ error: "This player already has a member account." });
    const code = generateInviteCode();
    const invite = await pool.query(
      "INSERT INTO invite_codes (label, code_hash, bound_roster_id, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '30 days') RETURNING id, label, created_at, expires_at, bound_roster_id",
      [player.rows[0].display_name, hashInviteCode(code), rosterId]
    );
    res.set("Cache-Control", "no-store, private");
    res.status(201).json({
      invite: invite.rows[0],
      code,
      message: "Invite created for " + player.rows[0].display_name + ". This code is shown only once — copy it now. Only this player can redeem it, by entering this code and their exact application name."
    });
  } catch (error) { next(error); }
});


app.get("/api/staff/security-events", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    // IPs are logged only as truncated SHA-256 hashes; row detail stays staff-only.
    const result = await pool.query(
      "SELECT id, event_type, account_id, name_hint, ip_hash, detail, created_at FROM security_events ORDER BY created_at DESC LIMIT 100"
    );
    res.json({ events: result.rows });
  } catch (error) { next(error); }
});

// --- Member accounts (public; passwords/sessions stay hashed server-side only) ---
app.use("/api/accounts/login", loginFailLimiter);

app.post("/api/accounts/register", requireDatabase, async (req, res, next) => {
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^VAYNTR-[A-Za-z0-9-]+$/.test(code)) return res.status(400).json({ error: "Enter the invite code staff sent you." });
  if (name.length < 2 || name.length > 50) return res.status(400).json({ error: "Enter the display name you used in your application (2–50 characters)." });
  if (!isHardenedPassword(password)) return res.status(400).json({ error: STRONG_PASSWORD_MESSAGE });
  try {
    await pool.query("DELETE FROM account_sessions WHERE expires_at < NOW()");
    const found = await pool.query(
      "SELECT i.id, i.bound_roster_id, i.expires_at, i.revoked_at, i.redeemed_at, r.display_name, r.member_type, r.game, r.platform FROM invite_codes i LEFT JOIN roster_players r ON r.id = i.bound_roster_id WHERE i.code_hash = $1",
      [hashInviteCode(code)]
    );
    if (!found.rowCount) return res.status(400).json({ error: "That invite code is not recognized. Double-check it, or ask staff for a new one." });
    const invite = found.rows[0];
    const unusable = !invite.bound_roster_id || invite.revoked_at != null || invite.redeemed_at != null || !invite.expires_at || new Date(invite.expires_at).getTime() <= Date.now();
    if (unusable) return res.status(400).json({ error: "That invite code can no longer be used. Ask staff for a new one." });
    if (name.toLowerCase() !== String(invite.display_name).toLowerCase()) {
      return res.status(400).json({ error: "That name does not match the name on this invite. Enter the exact name from your application." });
    }
    const rosterPlayerId = invite.bound_roster_id;
    const existing = await pool.query("SELECT id FROM accounts WHERE roster_id = $1", [rosterPlayerId]);
    if (existing.rowCount) return res.status(409).json({ error: "This player already has an account. Use sign-in instead of a new invite." });
    const inserted = await pool.query(
      "INSERT INTO accounts (roster_id, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, created_at",
      [rosterPlayerId, String(invite.display_name), hashPassword(password)]
    );
    await pool.query(
      "UPDATE invite_codes SET redeemed_at = NOW(), redeemed_by = $1 WHERE id = $2",
      [String(invite.display_name), invite.id]
    );
    const session = createSessionToken();
    await pool.query(
      "INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
      [session.tokenHash, inserted.rows[0].id]
    );
    res.set("Cache-Control", "no-store, private");
    res.status(201).json({
      session: { token: session.token, expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString() },
      member: { displayName: invite.display_name, memberType: invite.member_type || "player" },
      message: "Account created. You are signed in — save your password somewhere safe."
    });
  } catch (error) {
    if (error && error.code === "23505") return res.status(409).json({ error: "That player name already has an account. Use sign-in instead." });
    return next(error);
  }
});

app.post("/api/accounts/login", requireDatabase, async (req, res, next) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const powNonce = typeof req.body.powNonce === "string" ? req.body.powNonce.trim() : "";
  const powSalt = typeof req.body.powSalt === "string" ? req.body.powSalt.trim() : "";
  if (!name || !password) return res.status(400).json({ error: "Enter your player name and password." });
  try {
    await pool.query("DELETE FROM account_sessions WHERE expires_at < NOW()");
    await pool.query("DELETE FROM mfa_challenges WHERE expires_at < NOW()");
    // A client-supplied proof-of-work must actually meet the difficulty; otherwise the attempt stops here.
    if (powSalt || powNonce) {
      const powValid = Boolean(powSalt && powNonce && meetsProofOfWork(powSalt, powNonce, POW_DIFFICULTY_BITS));
      if (!powValid) {
        return res.status(400).json({ error: "Security challenge failed. Complete the browser check and try again.", pow: issuePowChallenge(), powRequired: true });
      }
    }
    const found = await pool.query(
      "SELECT id, password_hash, failed_login_count, lockout_until, mfa_enabled FROM accounts WHERE LOWER(display_name) = LOWER($1)",
      [name]
    );
    const account = found.rows[0];
    if (account && account.lockout_until && new Date(account.lockout_until).getTime() > Date.now()) {
      const minutes = Math.ceil((new Date(account.lockout_until).getTime() - Date.now()) / 60000);
      securityLogger(pool, "login_locked", { accountId: account.id, nameHint: name, ip: req.ip, detail: "Blocked during an active lockout window." });
      return res.status(423).json({ error: "Too many failed sign-in attempts. This account is locked for about " + minutes + " more minute(s).", lockoutMinutes: minutes });
    }
    const passwordOk = Boolean(account) && verifyPassword(password, account.password_hash);
    if (!passwordOk) {
      let failedCount = 0;
      if (account) {
        const bumped = await bumpFailedLogins(account.id);
        failedCount = bumped && bumped.failed_login_count || 0;
        if (bumped && bumped.lockout_until && new Date(bumped.lockout_until).getTime() > Date.now()) {
          securityLogger(pool, "account_locked", { accountId: account.id, nameHint: name, ip: req.ip, detail: "Auto-locked after " + LOCKOUT_THRESHOLD + " failed sign-ins." });
        }
      }
      const ipFailures = noteIpFailure(req.ip);
      const powRequired = Math.max(failedCount, ipFailures) >= 2;
      securityLogger(pool, "login_failed", { accountId: account ? account.id : null, nameHint: name, ip: req.ip, detail: powRequired ? "Proof-of-work required for the next attempt." : null });
      const body = { error: "The player name or password is incorrect." };
      if (powRequired) { body.pow = issuePowChallenge(); body.powRequired = true; }
      return res.status(401).json(body);
    }
    if (account.mfa_enabled) {
      // Password is correct; hold the session until the authenticator code is verified.
      const challenge = createSessionToken();
      await pool.query(
        "INSERT INTO mfa_challenges (token_hash, account_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes')",
        [challenge.tokenHash, account.id]
      );
      res.set("Cache-Control", "no-store, private");
      return res.json({
        mfaRequired: true,
        mfaToken: challenge.token,
        expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
        message: "Enter the current 6-digit code from your authenticator app."
      });
    }
    await pool.query("UPDATE accounts SET failed_login_count = 0, lockout_cycles = 0, lockout_until = NULL, last_login_at = NOW() WHERE id = $1", [account.id]);
    const session = createSessionToken();
    await pool.query(
      "INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
      [session.tokenHash, account.id]
    );
    securityLogger(pool, "login_success", { accountId: account.id, nameHint: name, ip: req.ip });
    const profile = await pool.query(
      "SELECT a.id AS account_id, a.roster_id, a.created_at AS member_since, a.mfa_enabled, r.display_name, r.member_type, r.game, r.platform, r.role, r.bio, r.social_links, r.profile_image_url, r.social_url, r.age, r.show_age_on_profile, (r.avatar_data IS NOT NULL) AS has_avatar FROM accounts a JOIN roster_players r ON r.id = a.roster_id WHERE a.id = $1",
      [account.id]
    );
    res.set("Cache-Control", "no-store, private");
    res.json({
      session: { token: session.token, expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString() },
      member: memberProfilePayload(profile.rows[0])
    });
  } catch (error) { return next(error); }
});

const mfaVerifyFailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: "draft-7", legacyHeaders: false, skipSuccessfulRequests: true, message: { error: "Too many incorrect authentication codes. Please wait 15 minutes and try again." } });
app.use("/api/accounts/login/verify", mfaVerifyFailLimiter);
app.post("/api/accounts/login/verify", requireDatabase, async (req, res, next) => {
  const mfaToken = typeof req.body.mfaToken === "string" ? req.body.mfaToken.trim() : "";
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  if (!mfaToken || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the current 6-digit code from your authenticator app." });
  try {
    const found = await pool.query(
      "SELECT c.account_id, a.mfa_secret_encrypted FROM mfa_challenges c JOIN accounts a ON a.id = c.account_id WHERE c.token_hash = $1 AND c.expires_at > NOW()",
      [sha256Hex(mfaToken)]
    );
    if (!found.rowCount) return res.status(400).json({ error: "This verification request expired. Please sign in again." });
    const secret = decryptTotpSecret(found.rows[0].mfa_secret_encrypted);
    if (!secret || !verifyTotpCode(secret, code)) {
      securityLogger(pool, "mfa_failed", { accountId: found.rows[0].account_id, ip: req.ip, detail: "Incorrect MFA code." });
      return res.status(401).json({ error: "That code is not correct. Enter the current 6-digit code from your authenticator app." });
    }
    await pool.query("DELETE FROM mfa_challenges WHERE token_hash = $1", [sha256Hex(mfaToken)]);
    await pool.query("UPDATE accounts SET failed_login_count = 0, lockout_cycles = 0, lockout_until = NULL, last_login_at = NOW() WHERE id = $1", [found.rows[0].account_id]);
    const session = createSessionToken();
    await pool.query(
      "INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
      [session.tokenHash, found.rows[0].account_id]
    );
    securityLogger(pool, "login_success", { accountId: found.rows[0].account_id, ip: req.ip, detail: "Signed in with an MFA code." });
    const profile = await pool.query(
      "SELECT a.id AS account_id, a.roster_id, a.created_at AS member_since, a.mfa_enabled, r.display_name, r.member_type, r.game, r.platform, r.role, r.bio, r.social_links, r.profile_image_url, r.social_url, r.age, r.show_age_on_profile, (r.avatar_data IS NOT NULL) AS has_avatar FROM accounts a JOIN roster_players r ON r.id = a.roster_id WHERE a.id = $1",
      [found.rows[0].account_id]
    );
    res.set("Cache-Control", "no-store, private");
    res.json({
      session: { token: session.token, expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString() },
      member: memberProfilePayload(profile.rows[0])
    });
  } catch (error) { return next(error); }
});

app.post("/api/me/mfa/enroll", requireMemberSession, async (req, res, next) => {
  if (req.member.mfa_enabled) return res.status(409).json({ error: "Multi-factor authentication is already enabled on your account. Disable it first if you need to re-enroll." });
  if (!process.env.JWT_SECRET) return res.status(503).json({ error: "MFA setup is not available: the server encryption key is missing. Contact staff." });
  try {
    const secret = base32Encode(crypto.randomBytes(20));
    const uri = "otpauth://totp/" + encodeURIComponent("VAYNTR:" + req.member.display_name) + "?secret=" + secret + "&issuer=VAYNTR&algorithm=SHA1&digits=6&period=30";
    await pool.query(
      "UPDATE accounts SET mfa_secret_encrypted = $1, mfa_enabled = FALSE WHERE id = $2",
      [encryptTotpSecret(secret), req.member.account_id]
    );
    securityLogger(pool, "mfa_enroll_started", { accountId: req.member.account_id, ip: req.ip });
    res.set("Cache-Control", "no-store, private");
    res.json({ secret, uri, message: "Add this secret (or the linked ticket) to your authenticator app, then confirm with a current code below." });
  } catch (error) { next(error); }
});

app.post("/api/me/mfa/activate", requireMemberSession, async (req, res, next) => {
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  try {
    const stored = await pool.query("SELECT mfa_secret_encrypted, mfa_enabled FROM accounts WHERE id = $1", [req.member.account_id]);
    const row = stored.rows[0];
    if (!row || row.mfa_enabled) return res.status(409).json({ error: "There is no pending MFA setup for your account." });
    if (!row.mfa_secret_encrypted) return res.status(409).json({ error: "Start the MFA setup first." });
    const secret = decryptTotpSecret(row.mfa_secret_encrypted);
    if (!secret || !verifyTotpCode(secret, code)) {
      securityLogger(pool, "mfa_failed", { accountId: req.member.account_id, ip: req.ip, detail: "Incorrect enrollment code." });
      return res.status(400).json({ error: "That code is not correct. Enter the current 6-digit code from your authenticator app." });
    }
    await pool.query("UPDATE accounts SET mfa_enabled = TRUE WHERE id = $1", [req.member.account_id]);
    securityLogger(pool, "mfa_activated", { accountId: req.member.account_id, ip: req.ip });
    res.json({ mfaEnabled: true, message: "Multi-factor authentication is on. Every sign-in now needs your authenticator app." });
  } catch (error) { next(error); }
});

app.post("/api/me/mfa/disable", requireMemberSession, async (req, res, next) => {
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  try {
    const stored = await pool.query("SELECT mfa_secret_encrypted, mfa_enabled FROM accounts WHERE id = $1", [req.member.account_id]);
    const row = stored.rows[0];
    if (!row || !row.mfa_enabled) return res.status(409).json({ error: "Multi-factor authentication is not enabled on your account." });
    const secret = decryptTotpSecret(row.mfa_secret_encrypted);
    if (!secret || !verifyTotpCode(secret, code)) {
      securityLogger(pool, "mfa_failed", { accountId: req.member.account_id, ip: req.ip, detail: "Incorrect code while disabling MFA." });
      return res.status(400).json({ error: "That code is not correct. Enter the current 6-digit code from your authenticator app." });
    }
    await pool.query("UPDATE accounts SET mfa_enabled = FALSE, mfa_secret_encrypted = NULL WHERE id = $1", [req.member.account_id]);
    securityLogger(pool, "mfa_disabled", { accountId: req.member.account_id, ip: req.ip });
    res.json({ mfaEnabled: false, message: "Multi-factor authentication is off for your account." });
  } catch (error) { next(error); }
});

app.post("/api/accounts/logout", requireMemberSession, async (req, res, next) => {
  try {
    const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    await pool.query("DELETE FROM account_sessions WHERE token_hash = $1", [sha256Hex(match[1])]);
    res.json({ loggedOut: true, message: "Signed out." });
  } catch (error) { next(error); }
});

app.get("/api/me", requireMemberSession, async (req, res, next) => {
  try {
    res.json({ member: memberProfilePayload(req.member) });
  } catch (error) { next(error); }
});

app.post("/api/me/social-links", requireMemberSession, async (req, res, next) => {
  const links = Array.isArray(req.body.links) ? req.body.links : [];
  if (links.length > MAX_SOCIAL_LINKS) return res.status(400).json({ error: "You can list up to 3 social links." });
  const validated = links.map((link) => {
    const url = link && typeof link === "object" ? link.url : link;
    const label = link && typeof link === "object" && typeof link.label === "string" ? link.label.trim().slice(0, 40) : "";
    return { label, url };
  });
  if (!isValidSocialLinksArray(validated)) return res.status(400).json({ error: "Social links must be valid HTTPS URLs (up to 3)." });
  try {
    const result = await pool.query(
      "UPDATE roster_players SET social_links = $1 WHERE id = $2 RETURNING social_links",
      [JSON.stringify(validated), req.member.roster_id]
    );
    res.json({ socialLinks: result.rows[0].social_links, message: "Your public social links were updated." });
  } catch (error) { next(error); }
});

// Self-service public profile: bio text and age visibility live on the roster record.
app.post("/api/me/profile", requireMemberSession, async (req, res, next) => {
  const bio = typeof req.body.bio === "string" ? req.body.bio.trim().slice(0, 1000) : "";
  const showAgeOnProfile = req.body.showAgeOnProfile === true;
  if (bio.length > 500) return res.status(400).json({ error: "Your public bio must be 500 characters or fewer." });
  try {
    await pool.query(
      "UPDATE roster_players SET bio = $1, show_age_on_profile = $2 WHERE id = $3",
      [bio, showAgeOnProfile, req.member.roster_id]
    );
    res.json({ message: showAgeOnProfile ? "Public bio saved; your age is now visible on the roster." : "Public bio saved; your age stays private." });
  } catch (error) { next(error); }
});

// Self-service profile picture: a true binary upload stored in the database.
app.post("/api/me/avatar", express.raw({ type: () => true, limit: MAX_AVATAR_BYTES + 2048 }), requireMemberSession, async (req, res, next) => {
  const image = Buffer.isBuffer(req.body) ? req.body : null;
  if (!image || !image.length) return res.status(400).json({ error: "Choose an image file to upload." });
  const contentType = detectImageContentType(image);
  if (!contentType) return res.status(400).json({ error: "The picture must be a PNG, JPEG, or WebP image." });
  if (image.length > MAX_AVATAR_BYTES) return res.status(400).json({ error: "Profile pictures must be 300 KB or smaller." });
  try {
    await pool.query(
      "UPDATE roster_players SET avatar_data = $1, avatar_content_type = $2, avatar_updated_at = NOW() WHERE id = $3",
      [image, contentType, req.member.roster_id]
    );
    securityLogger(pool, "avatar_updated", { accountId: req.member.account_id, ip: req.ip });
    res.json({ hasAvatar: true, message: "Your profile picture was saved. It may take a minute to appear everywhere." });
  } catch (error) { next(error); }
});

app.delete("/api/me/avatar", requireMemberSession, async (req, res, next) => {
  try {
    await pool.query(
      "UPDATE roster_players SET avatar_data = NULL, avatar_content_type = NULL, avatar_updated_at = NULL WHERE id = $1",
      [req.member.roster_id]
    );
    res.json({ hasAvatar: false, message: "Your uploaded profile picture was removed." });
  } catch (error) { next(error); }
});

// Public avatar bytes for a roster member; referenced by the roster/player pages and the staff site.
app.get("/api/members/:id/avatar", requireDatabase, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid member ID." });
  try {
    const found = await pool.query(
      "SELECT avatar_data, avatar_content_type, avatar_updated_at FROM roster_players WHERE id = $1",
      [id]
    );
    const row = found.rows[0];
    if (!row || !row.avatar_data) return res.status(404).json({ error: "No profile picture." });
    res.set("Content-Type", row.avatar_content_type || "image/png");
    res.set("Cache-Control", "public, max-age=300");
    res.send(row.avatar_data);
  } catch (error) { next(error); }
});

// Accept or deny an applicant in one operation.
// Accept atomically copies the minimum roster/contact fields and then deletes the application.
// Deny deletes the application without adding the person to the roster. No email is sent automatically.
app.post("/api/staff/applications/:id/decision", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const id = Number(req.params.id);
  const decision = req.body.decision;
  if (!Number.isSafeInteger(id) || id < 1 || !["accept", "deny"].includes(decision)) {
    return res.status(400).json({ error: "Invalid application ID or decision." });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT id, display_name, email, game, platform, age, show_age_on_profile, track, social_links FROM recruitment_applications WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "This application no longer exists. Refresh the queue." });
    }
    const applicant = found.rows[0];
    let rosterPlayer = null;
    if (decision === "accept") {
      const added = await client.query(
        `INSERT INTO roster_players (display_name, email, game, platform, age, show_age_on_profile, member_type, social_links, source_application_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (source_application_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             email = EXCLUDED.email,
             game = EXCLUDED.game,
             platform = EXCLUDED.platform,
             age = EXCLUDED.age,
             show_age_on_profile = EXCLUDED.show_age_on_profile,
             member_type = EXCLUDED.member_type,
             social_links = EXCLUDED.social_links
         RETURNING id, display_name, game, platform, age, show_age_on_profile, member_type, social_links, accepted_at`,
        [applicant.display_name, applicant.email, applicant.game, applicant.platform, applicant.age, applicant.show_age_on_profile, applicant.track || "player", applicant.social_links || JSON.stringify([]), applicant.id]
      );
      rosterPlayer = added.rows[0];
    }
    await client.query("DELETE FROM recruitment_applications WHERE id = $1", [id]);
    await client.query("COMMIT");
    return res.json({
      decision,
      applicationDeleted: true,
      rosterPlayer,
      // Returned only from this staff-token-protected route, so the operator can compose a manual follow-up after the application is deleted.
      contact: { displayName: applicant.display_name, email: applicant.email },
      message: decision === "accept"
        ? "Applicant added to the VAYNTR roster and application deleted. Their email is also available in the staff roster. Issue their invite from the roster card when they are ready for an account."
        : "Application denied and permanently deleted. You can compose the manual response from the follow-up panel."
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    if (client) client.release();
  }
});

// Removing a roster player is staff-only and never sends an email.
app.post("/api/staff/roster/:id/remove", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid roster player ID." });
  try {
    const result = await pool.query(
      "DELETE FROM roster_players WHERE id = $1 RETURNING id, display_name, game, platform",
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "This roster player no longer exists. Refresh the roster." });
    res.json({ removed: true, player: result.rows[0], message: "Player removed from the public VAYNTR roster." });
  } catch (error) { next(error); }
});

app.post("/api/staff/applications/:id/confirmation-email", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid application ID." });
  try {
    const result = await pool.query(
      "SELECT id, display_name, email FROM recruitment_applications WHERE id = $1",
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Application not found." });
    const notification = await sendApplicationReceivedEmail(result.rows[0]);
    await pool.query(
      "UPDATE recruitment_applications SET confirmation_email_status = $1, confirmation_email_sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE confirmation_email_sent_at END WHERE id = $2",
      [notification.sent ? "sent" : notification.reason, id]
    );
    res.json({ notification });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }));
app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") return res.status(403).json({ error: "Origin not allowed." });
  // Return useful HTTP status codes for malformed/oversized JSON without exposing parser details.
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Request body must contain valid JSON." });
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
  console.error("API request failed:", error.message);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

const schema = `
CREATE TABLE IF NOT EXISTS recruitment_applications (
 id BIGSERIAL PRIMARY KEY, display_name TEXT NOT NULL, email TEXT NOT NULL,
 platform TEXT NOT NULL CHECK (platform IN ('PlayStation', 'Xbox', 'PC', 'Cross-platform')),
 game TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', youtube_url TEXT,
 privacy_consent BOOLEAN NOT NULL DEFAULT FALSE, privacy_consent_at TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'reviewing', 'accepted', 'declined')),
 confirmation_email_status TEXT NOT NULL DEFAULT 'pending', confirmation_email_sent_at TIMESTAMPTZ,
 decision_notified_status TEXT CHECK (decision_notified_status IN ('accepted', 'declined')),
 decision_email_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS youtube_url TEXT;
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS privacy_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMPTZ;
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS confirmation_email_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS decision_notified_status TEXT;
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS decision_email_error TEXT;
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS show_age_on_profile BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS recruitment_applications_created_at_idx ON recruitment_applications (created_at DESC);
CREATE TABLE IF NOT EXISTS roster_players (
 id BIGSERIAL PRIMARY KEY,
 display_name TEXT NOT NULL,
 email TEXT NOT NULL,
 game TEXT NOT NULL,
 platform TEXT NOT NULL CHECK (platform IN ('PlayStation', 'Xbox', 'PC', 'Cross-platform')),
 source_application_id BIGINT NOT NULL UNIQUE,
 accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS roster_players_game_name_idx ON roster_players (game, display_name);
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Player';
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS social_url TEXT;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS highlight_url TEXT;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS show_age_on_profile BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'player';
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS avatar_data BYTEA;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS avatar_content_type TEXT;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'player';
ALTER TABLE recruitment_applications ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS bound_roster_id BIGINT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lockout_cycles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT;
CREATE TABLE IF NOT EXISTS mfa_challenges (
 token_hash TEXT PRIMARY KEY,
 account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS mfa_challenges_expiry_idx ON mfa_challenges (expires_at);
CREATE TABLE IF NOT EXISTS security_events (
 id BIGSERIAL PRIMARY KEY,
 event_type TEXT NOT NULL,
 account_id BIGINT,
 name_hint TEXT,
 ip_hash TEXT,
 detail TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON security_events (created_at DESC);

-- Member accounts: one account per accepted roster member, bound to the roster row
-- (cascade delete removes accounts and sessions when a player is removed).
CREATE TABLE IF NOT EXISTS accounts (
 id BIGSERIAL PRIMARY KEY,
 roster_id BIGINT NOT NULL UNIQUE REFERENCES roster_players(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_display_name_lower_idx ON accounts (LOWER(display_name));
CREATE TABLE IF NOT EXISTS account_sessions (
 token_hash TEXT PRIMARY KEY,
 account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions (account_id);
CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx ON account_sessions (expires_at);

-- One-time member invites. code_hash is a SHA-256 hex digest; the plaintext code is returned once by the API and is never stored.
CREATE TABLE IF NOT EXISTS invite_codes (
 id BIGSERIAL PRIMARY KEY,
 label TEXT NOT NULL DEFAULT '',
 code_hash TEXT NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 redeemed_at TIMESTAMPTZ,
 redeemed_by TEXT
);
CREATE INDEX IF NOT EXISTS invite_codes_created_at_idx ON invite_codes (created_at DESC);

CREATE TABLE IF NOT EXISTS site_content (
 id BIGSERIAL PRIMARY KEY,
 content_type TEXT NOT NULL CHECK (content_type IN ('news', 'result', 'media')),
 title TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT '',
 excerpt TEXT NOT NULL DEFAULT '',
 body TEXT NOT NULL DEFAULT '',
 game TEXT NOT NULL DEFAULT '',
 event_name TEXT NOT NULL DEFAULT '',
 opponent TEXT NOT NULL DEFAULT '',
 score TEXT NOT NULL DEFAULT '',
 outcome TEXT NOT NULL DEFAULT '',
 played_at DATE,
 source_url TEXT,
 image_url TEXT,
 published BOOLEAN NOT NULL DEFAULT FALSE,
 verified BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS site_content_public_feed_idx ON site_content (content_type, published, created_at DESC);
`;
async function start() {
  if (pool) { await pool.query(schema); console.log("Database schema is ready."); }
  else console.warn("DATABASE_URL is not set; database-backed endpoints will return 503.");
  app.listen(PORT, "0.0.0.0", () => console.log(`VAYNTR API listening on port ${PORT}`));
}
start().catch((error) => { console.error("Startup failed:", error.message); process.exit(1); });
process.on("SIGTERM", async () => { if (pool) await pool.end().catch(() => {}); process.exit(0); });
