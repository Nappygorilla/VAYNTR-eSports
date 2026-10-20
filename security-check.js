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
assert.match(source, /res\.set\(["']Cache-Control["'],\s*["']no-store, private["']\)/,
  "Protected staff responses must disable caching.");

const staffRoutes = source.split("\n").filter((line) =>
  /app\.(?:get|post|put|patch|delete)\(["']\/api\/staff\//.test(line)
);
assert.ok(staffRoutes.length > 0, "At least one staff route should be found.");
for (const route of staffRoutes) {
  assert.match(route, /requireStaffAccess/,
    "Every staff endpoint must include requireStaffAccess: " + route.trim());
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

console.log("Security source checks passed.");
