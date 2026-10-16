"use strict";

const express = require("express");
const crypto = require("node:crypto");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || "https://nappygorilla.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || "";
const STAFF_REVIEW_TOKEN = process.env.STAFF_REVIEW_TOKEN || "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
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

async function sendApplicationDecisionEmail(application, status) {
  const accepted = status === "accepted";
  return sendVayntrEmail({
    to: application.email,
    subject: "VAYNTR Esports | Recruitment Decision",
    title: accepted ? "WELCOME TO VAYNTR" : "RECRUITMENT DECISION",
    displayName: application.display_name,
    preheader: accepted ? "A decision has been recorded on your VAYNTR application." : "Your VAYNTR Esports recruitment decision is ready.",
    statusLabel: accepted ? "APPROVED" : "NOT SELECTED",
    paragraphs: accepted
      ? [
          "We're pleased to let you know that your VAYNTR Esports application has been approved.",
          "Welcome to VAYNTR. Our team will follow up with any onboarding steps and the information you need next."
        ]
      : [
          "Thank you for taking the time to apply to VAYNTR Esports and share your video.",
          "After reviewing your application, we've decided not to move forward at this time. We appreciate your interest and wish you the best in your continued progress."
        ]
  });
}


if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be set in Render and contain at least 32 characters.");
  process.exit(1);
}
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
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
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many attempts. Please wait and try again." } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });
app.use("/api", apiLimiter);

function requireDatabase(_req, res, next) {
  if (!pool) return res.status(503).json({ error: "Database is not configured yet." });
  next();
}
function tokenFor(user) {
  return jwt.sign({ sub: String(user.id) }, JWT_SECRET, { expiresIn: "2h", issuer: "vayntr-api" });
}
async function authenticate(req, res, next) {
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Sign in is required." });
  try {
    const payload = jwt.verify(match[1], JWT_SECRET, { issuer: "vayntr-api" });
    const result = await pool.query("SELECT id, email, display_name, role, created_at FROM users WHERE id = $1", [payload.sub]);
    if (!result.rowCount) return res.status(401).json({ error: "Account not found." });
    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") return res.status(401).json({ error: "Your session is invalid or expired. Please sign in again." });
    next(error);
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission to do that." });
    next();
  };
}

function requireStaffAccess(req, res, next) {
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (STAFF_REVIEW_TOKEN.length >= 32 && match) {
    const supplied = Buffer.from(match[1]);
    const expected = Buffer.from(STAFF_REVIEW_TOKEN);
    if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) {
      req.user = { id: null, display_name: "VAYNTR staff token", role: "admin" };
      return next();
    }
  }
  // Legacy staff/admin JWTs continue to work; regular member accounts are never granted staff access.
  return authenticate(req, res, (error) => {
    if (error) return next(error);
    if (!req.user || !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to review applications." });
    }
    next();
  });
}

app.get("/health", async (_req, res) => {
  let database = "not_configured";
  if (pool) {
    try { await pool.query("SELECT 1"); database = "connected"; }
    catch { database = "unavailable"; }
  }
  res.status(database === "unavailable" ? 503 : 200).json({ ok: database !== "unavailable", service: "vayntr-api", database, time: new Date().toISOString() });
});
app.get("/api/status", async (_req, res) => {
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
      accounts: false,
      recruitmentApplications: databaseReady,
      staffTools: databaseReady,
      emailNotifications: Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL),
      staffReviewConfigured: STAFF_REVIEW_TOKEN.length >= 32
    }
  });
});

app.get("/api/roster", requireDatabase, async (_req, res, next) => {
  try {
    // Public roster data intentionally excludes email addresses and other applicant-only information.
    const result = await pool.query(
      "SELECT id, display_name, game, platform, accepted_at FROM roster_players ORDER BY game ASC, display_name ASC"
    );
    res.set("Cache-Control", "no-store");
    res.json({ players: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/auth/register", authLimiter, requireDatabase, async (req, res, next) => {
  if (process.env.ENABLE_PUBLIC_REGISTRATION !== "true") return res.status(404).json({ error: "Public account registration is disabled." });
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (displayName.length < 2 || displayName.length > 50) return res.status(400).json({ error: "Display name must be 2–50 characters." });
    if (password.length < 12 || password.length > 128) return res.status(400).json({ error: "Password must be 12–128 characters." });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query("INSERT INTO users (email, display_name, password_hash, role) VALUES ($1, $2, $3, 'member') RETURNING id, email, display_name, role, created_at", [email, displayName, passwordHash]);
    const user = result.rows[0];
    res.status(201).json({ user, token: tokenFor(user) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    next(error);
  }
});
app.post("/api/auth/login", authLimiter, requireDatabase, async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const result = await pool.query("SELECT id, email, display_name, role, password_hash, created_at FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    const valid = user && await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Email or password is incorrect." });
    delete user.password_hash;
    res.json({ user, token: tokenFor(user) });
  } catch (error) { next(error); }
});
app.get("/api/auth/me", requireDatabase, authenticate, (req, res) => res.json({ user: req.user }));

app.post("/api/recruitment/applications", requireDatabase, async (req, res, next) => {
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

    if (displayName.length < 2 || displayName.length > 50) return res.status(400).json({ error: "Display name must be 2–50 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (!["PlayStation", "Xbox", "PC", "Cross-platform"].includes(platform)) return res.status(400).json({ error: "Choose a valid platform." });
    if (game.length < 2 || game.length > 80) return res.status(400).json({ error: "Enter the game or division you are applying for." });
    if (!youtubeUrl) return res.status(400).json({ error: "Submit a valid YouTube video link, not a channel or playlist link." });
    if (!privacyConsent) return res.status(400).json({ error: "Confirm the application privacy acknowledgement before submitting." });
    if (message.length > 2000) return res.status(400).json({ error: "Additional information must be 2,000 characters or fewer." });

    const result = await pool.query(
      "INSERT INTO recruitment_applications (display_name, email, platform, game, message, youtube_url, privacy_consent, privacy_consent_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id, status, created_at",
      [displayName, email, platform, game, message, youtubeUrl, privacyConsent]
    );
    const application = { ...result.rows[0], display_name: displayName, email };
    const notification = await sendApplicationReceivedEmail(application);
    await pool.query(
      "UPDATE recruitment_applications SET confirmation_email_status = $1, confirmation_email_sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE NULL END WHERE id = $2",
      [notification.sent ? "sent" : notification.reason, application.id]
    );

    res.status(201).json({
      application: result.rows[0],
      notification,
      message: notification.sent
        ? "Application received. Your confirmation email has been queued."
        : "Application received, but the confirmation email could not be sent yet. Your application is saved."
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/staff/applications", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, display_name, email, platform, game, message, youtube_url, status, created_at, confirmation_email_status, decision_notified_status, decision_email_error FROM recruitment_applications ORDER BY created_at DESC LIMIT 100");
    res.json({ applications: result.rows });
  } catch (error) { next(error); }
});
app.get("/api/staff/roster", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    // Email is exposed only inside this authenticated staff endpoint so the operator can contact players manually.
    const result = await pool.query(
      "SELECT id, display_name, email, game, platform, accepted_at FROM roster_players ORDER BY accepted_at DESC"
    );
    res.json({ players: result.rows });
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
      "SELECT id, display_name, email, game, platform FROM recruitment_applications WHERE id = $1 FOR UPDATE",
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
        `INSERT INTO roster_players (display_name, email, game, platform, source_application_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_application_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             email = EXCLUDED.email,
             game = EXCLUDED.game,
             platform = EXCLUDED.platform
         RETURNING id, display_name, game, platform, accepted_at`,
        [applicant.display_name, applicant.email, applicant.game, applicant.platform, applicant.id]
      );
      rosterPlayer = added.rows[0];
    }
    await client.query("DELETE FROM recruitment_applications WHERE id = $1", [id]);
    await client.query("COMMIT");
    return res.json({
      decision,
      applicationDeleted: true,
      rosterPlayer,
      message: decision === "accept"
        ? "Applicant added to the VAYNTR roster and application deleted. Email them manually using the staff roster contact list."
        : "Application denied and permanently deleted."
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    if (client) client.release();
  }
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

app.post("/api/staff/applications/:id/status", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!Number.isSafeInteger(id) || id < 1 || !["received", "reviewing", "accepted", "declined"].includes(status)) {
    return res.status(400).json({ error: "Invalid application ID or status." });
  }

  let current;
  let updated;
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT id, display_name, email, status, decision_notified_status FROM recruitment_applications WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Application not found." });
    }
    current = currentResult.rows[0];
    const updateResult = await client.query(
      "UPDATE recruitment_applications SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status, updated_at",
      [status, id]
    );
    updated = updateResult.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally {
    if (client) client.release();
  }

  let notification = null;
  if (status === "accepted" || status === "declined") {
    if (current.decision_notified_status === status) {
      notification = { sent: true, reason: "already_notified" };
    } else {
      notification = await sendApplicationDecisionEmail(current, status);
      if (notification.sent) {
        await pool.query(
          "UPDATE recruitment_applications SET decision_notified_status = $1, decision_email_error = NULL WHERE id = $2",
          [status, id]
        );
      } else {
        await pool.query(
          "UPDATE recruitment_applications SET decision_email_error = $1 WHERE id = $2",
          [notification.reason, id]
        );
      }
    }
  }

  res.json({ application: updated, notification });
});

app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }));
app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") return res.status(403).json({ error: "Origin not allowed." });
  console.error("API request failed:", error.message);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

const schema = `
CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'staff', 'admin')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
`;
async function start() {
  if (pool) { await pool.query(schema); console.log("Database schema is ready."); }
  else console.warn("DATABASE_URL is not set; database-backed endpoints will return 503.");
  app.listen(PORT, "0.0.0.0", () => console.log(`VAYNTR API listening on port ${PORT}`));
}
start().catch((error) => { console.error("Startup failed:", error.message); process.exit(1); });
process.on("SIGTERM", async () => { if (pool) await pool.end().catch(() => {}); process.exit(0); });
