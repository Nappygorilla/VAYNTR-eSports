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
const STAFF_REVIEW_TOKEN = process.env.STAFF_REVIEW_TOKEN || "";

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
const recruitmentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many applications from this connection. Please wait and try again." } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });
app.use("/api", apiLimiter);

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
    // Only fields needed by public cards/profiles leave this route. Contact emails and internal timestamps stay private.
    const result = await pool.query(
      "SELECT id, display_name, game, platform, role, bio, social_url, highlight_url, profile_image_url FROM roster_players ORDER BY game ASC, display_name ASC"
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
    const result = await pool.query("SELECT id, display_name, email, platform, game, message, youtube_url, status, created_at, confirmation_email_status, decision_notified_status, decision_email_error FROM recruitment_applications ORDER BY created_at DESC LIMIT 100");
    res.json({ applications: result.rows });
  } catch (error) { next(error); }
});
app.get("/api/staff/roster", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    // Email is exposed only inside this authenticated staff endpoint so the operator can contact players manually.
    const result = await pool.query(
      "SELECT id, display_name, email, game, platform, role, bio, social_url, highlight_url, profile_image_url, accepted_at FROM roster_players ORDER BY accepted_at DESC"
    );
    res.json({ players: result.rows });
  } catch (error) { next(error); }
});


// Public feeds return published items only. Match results also require staff verification.
app.get("/api/news", requireDatabase, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, played_at, source_url, image_url, created_at, updated_at FROM site_content WHERE content_type='news' AND published=TRUE ORDER BY created_at DESC LIMIT 50");
    res.set("Cache-Control", "no-store"); res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.get("/api/results", requireDatabase, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, content_type, verified, title, category, excerpt, body, game, event_name, opponent, score, outcome, played_at, source_url, image_url, created_at, updated_at FROM site_content WHERE content_type='result' AND published=TRUE AND verified=TRUE AND source_url IS NOT NULL ORDER BY played_at DESC NULLS LAST, created_at DESC LIMIT 100");
    res.set("Cache-Control", "no-store"); res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.get("/api/media", requireDatabase, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, played_at, source_url, image_url, created_at, updated_at FROM site_content WHERE content_type='media' AND published=TRUE AND (source_url IS NOT NULL OR image_url IS NOT NULL) ORDER BY created_at DESC LIMIT 100");
    res.set("Cache-Control", "no-store"); res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/staff/roster/:id/update", requireDatabase, requireStaffAccess, async (req, res, next) => {
  const id = Number(req.params.id);
  const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
  const game = typeof req.body.game === "string" ? req.body.game.trim() : "";
  const platform = typeof req.body.platform === "string" ? req.body.platform.trim() : "";
  const role = typeof req.body.role === "string" ? req.body.role.trim() : "Player";
  const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
  const socialUrl = parseOptionalHttpsUrl(req.body.socialUrl);
  const highlightUrl = parseOptionalHttpsUrl(req.body.highlightUrl);
  const profileImageUrl = parseOptionalHttpsUrl(req.body.profileImageUrl);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid roster player ID." });
  if (displayName.length < 2 || displayName.length > 50) return res.status(400).json({ error: "Display name must be 2–50 characters." });
  if (game.length < 2 || game.length > 80) return res.status(400).json({ error: "Game/division must be 2–80 characters." });
  if (!["PlayStation", "Xbox", "PC", "Cross-platform"].includes(platform)) return res.status(400).json({ error: "Choose a valid platform." });
  if (role.length < 2 || role.length > 60 || bio.length > 500) return res.status(400).json({ error: "Role must be 2–60 characters and bio 500 characters or fewer." });
  if ([socialUrl, highlightUrl, profileImageUrl].some((url) => url === undefined)) return res.status(400).json({ error: "Profile, highlight, and image links must be valid HTTPS URLs." });
  try {
    const result = await pool.query(
      "UPDATE roster_players SET display_name=$1, game=$2, platform=$3, role=$4, bio=$5, social_url=$6, highlight_url=$7, profile_image_url=$8 WHERE id=$9 RETURNING id, display_name, game, platform, role, bio, social_url, highlight_url, profile_image_url, accepted_at",
      [displayName, game, platform, role, bio, socialUrl, highlightUrl, profileImageUrl, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "This roster player no longer exists. Refresh the roster." });
    res.json({ player: result.rows[0], message: "Player profile updated." });
  } catch (error) { next(error); }
});

app.get("/api/staff/content", requireDatabase, requireStaffAccess, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, played_at, source_url, image_url, published, verified, created_at, updated_at FROM site_content ORDER BY updated_at DESC LIMIT 200");
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
        "UPDATE site_content SET content_type=$1, title=$2, category=$3, excerpt=$4, body=$5, game=$6, event_name=$7, opponent=$8, score=$9, outcome=$10, played_at=$11, source_url=$12, image_url=$13, published=$14, verified=$15, updated_at=NOW() WHERE id=$16 RETURNING id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, played_at, source_url, image_url, published, verified, created_at, updated_at",
        [...values, id]
      );
      if (!result.rowCount) return res.status(404).json({ error: "Content item not found. Refresh the content desk." });
    } else {
      result = await pool.query(
        "INSERT INTO site_content (content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, played_at, source_url, image_url, published, verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, content_type, title, category, excerpt, body, game, event_name, opponent, score, outcome, played_at, source_url, image_url, published, verified, created_at, updated_at",
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
      // Returned only from this staff-token-protected route, so the operator can compose a manual follow-up after the application is deleted.
      contact: { displayName: applicant.display_name, email: applicant.email },
      message: decision === "accept"
        ? "Applicant added to the VAYNTR roster and application deleted. Their email is also available in the staff roster."
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
