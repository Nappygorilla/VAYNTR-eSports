"use strict";

const express = require("express");
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

app.get("/health", async (_req, res) => {
  let database = "not_configured";
  if (pool) {
    try { await pool.query("SELECT 1"); database = "connected"; }
    catch { database = "unavailable"; }
  }
  res.status(database === "unavailable" ? 503 : 200).json({ ok: database !== "unavailable", service: "vayntr-api", database, time: new Date().toISOString() });
});
app.get("/api/status", (_req, res) => res.json({ service: "VAYNTR API", status: "online", features: { health: true, accounts: Boolean(pool), recruitmentApplications: Boolean(pool), staffTools: Boolean(pool) } }));

app.post("/api/auth/register", authLimiter, requireDatabase, async (req, res, next) => {
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
  try {
    const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const platform = typeof req.body.platform === "string" ? req.body.platform.trim() : "";
    const game = typeof req.body.game === "string" ? req.body.game.trim() : "";
    const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
    if (displayName.length < 2 || displayName.length > 50) return res.status(400).json({ error: "Display name must be 2–50 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (!["PlayStation", "Xbox", "PC", "Cross-platform"].includes(platform)) return res.status(400).json({ error: "Choose a valid platform." });
    if (game.length < 2 || game.length > 80) return res.status(400).json({ error: "Enter the game or division you are applying for." });
    if (message.length > 2000) return res.status(400).json({ error: "Message must be 2,000 characters or fewer." });
    const result = await pool.query("INSERT INTO recruitment_applications (display_name, email, platform, game, message) VALUES ($1, $2, $3, $4, $5) RETURNING id, status, created_at", [displayName, email, platform, game, message]);
    res.status(201).json({ application: result.rows[0], message: "Application received. This is not a guarantee of acceptance." });
  } catch (error) { next(error); }
});
app.get("/api/staff/applications", requireDatabase, authenticate, requireRole("admin", "staff"), async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT id, display_name, email, platform, game, message, status, created_at FROM recruitment_applications ORDER BY created_at DESC LIMIT 100");
    res.json({ applications: result.rows });
  } catch (error) { next(error); }
});
app.post("/api/staff/applications/:id/status", requireDatabase, authenticate, requireRole("admin", "staff"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = req.body.status;
    if (!Number.isSafeInteger(id) || id < 1 || !["received", "reviewing", "accepted", "declined"].includes(status)) return res.status(400).json({ error: "Invalid application ID or status." });
    const result = await pool.query("UPDATE recruitment_applications SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status, updated_at", [status, id]);
    if (!result.rowCount) return res.status(404).json({ error: "Application not found." });
    res.json({ application: result.rows[0] });
  } catch (error) { next(error); }
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
 game TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'reviewing', 'accepted', 'declined')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recruitment_applications_created_at_idx ON recruitment_applications (created_at DESC);
`;
async function start() {
  if (pool) { await pool.query(schema); console.log("Database schema is ready."); }
  else console.warn("DATABASE_URL is not set; database-backed endpoints will return 503.");
  app.listen(PORT, "0.0.0.0", () => console.log(`VAYNTR API listening on port ${PORT}`));
}
start().catch((error) => { console.error("Startup failed:", error.message); process.exit(1); });
process.on("SIGTERM", async () => { if (pool) await pool.end().catch(() => {}); process.exit(0); });
