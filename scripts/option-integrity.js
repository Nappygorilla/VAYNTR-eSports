const fs = require("fs");
const html = fs.readFileSync("recruitment.html", "utf8");
const src = fs.readFileSync("server.js", "utf8");
function opts(id) {
  const select = html.match(new RegExp('<select id="' + id + '"[\\s\\S]*?</select>'));
  if (!select) return null;
  return [...select[0].matchAll(/<option>(.*?)<\/option>/g)].map((m) => m[1]);
}
function serverList(name) {
  const m = src.match(new RegExp("const " + name + " = \\[([\\s\\S]*?)\\];"));
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim().replace(/^(["'])([\s\S]*?)\1$/, "$2")).filter(Boolean);
}
let failures = 0;
for (const [htmlId, name] of [["availability", "AVAILABILITY_OPTIONS"], ["timezoneRegion", "TIMEZONE_OPTIONS"], ["scheduleWindow", "SCHEDULE_WINDOW_OPTIONS"], ["hasMic", "HAS_MIC_OPTIONS"], ["otherRosterStatus", "OTHER_ROSTER_OPTIONS"]]) {
  const h = JSON.stringify(opts(htmlId));
  const s = JSON.stringify(serverList(name));
  if (h === s) { console.log(htmlId + ": MATCH"); continue; }
  failures += 1;
  console.log(htmlId + ": MISMATCH\n  html=" + h + "\n  server=" + s);
}
const checkboxes = [...new Set([...html.matchAll(/name="mediaSkill" value="([^"]+)"/g)].map((m) => m[1]))];
const cs = JSON.stringify(checkboxes);
const css = JSON.stringify(serverList("MEDIA_SKILL_OPTIONS"));
if (cs === css) console.log("mediaSkill: MATCH");
else { failures += 1; console.log("mediaSkill: MISMATCH\n  html=" + cs + "\n  server=" + css); }
process.exitCode = failures ? 1 : 0;
