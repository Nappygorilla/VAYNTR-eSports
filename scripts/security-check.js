"use strict";

// Lightweight regression checks for security-critical API wiring.
// These are source-level guards, not a substitute for live endpoint testing.
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const staffRoutes = source.split("\n").filter((line) =>
  /\bapp\.(?:get|post|put|patch|delete)\(["']\/api\/staff\//.test(line)
);
assert(staffRoutes.length >= 8, "Expected to find the protected staff route declarations.");
for (const route of staffRoutes) {
  assert(route.includes("requireStaffAccess"), "Staff route is missing requireStaffAccess: " + route.trim());
}

assert(source.includes('app.use("/api/staff", staffAccessLimiter)'), "Staff access limiter must be mounted before staff routes.");
assert(source.includes("skipSuccessfulRequests: true"), "Staff rate limit should focus on unsuccessful requests.");
assert(source.includes('app.use("/api", apiLimiter)'), "General API rate limiter must remain enabled.");
assert(source.includes("recruitmentLimiter"), "Recruitment rate limiter must remain enabled.");
assert(source.includes('req.is("application/json")'), "POST API requests must enforce JSON content type.");
assert(source.includes("Array.isArray(req.body)"), "POST API requests must reject non-object JSON bodies.");
assert(source.includes('error.type === "entity.too.large"'), "Oversized request bodies must return a controlled client error.");
assert(source.includes('error instanceof SyntaxError'), "Malformed JSON must return a controlled client error.");
assert(source.includes('return res.status(500).json({ error: "An unexpected server error occurred." })'), "Unexpected errors must remain generic.");
assert(source.includes("crypto.timingSafeEqual(supplied, expected)"), "Staff token comparison must use timingSafeEqual.");
assert(source.includes("STAFF_REVIEW_TOKEN.length < 32"), "Staff access must require a sufficiently long token.");
assert(/SELECT id, display_name, game, platform, role, bio, social_url, highlight_url, profile_image_url FROM roster_players/.test(source), "Public roster query must not expose applicant email addresses.");

if (failures.length) {
  console.error("Security regression checks failed:");
  for (const failure of failures) console.error("- " + failure);
  process.exitCode = 1;
} else {
  console.log("Security regression checks passed (" + staffRoutes.length + " protected staff routes checked).");
}
