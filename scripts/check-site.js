"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const siteBasePath = "/";
const legacyProjectPrefix = "/VAYNTR-eSports/";
const externalProjectPrefixes = ["/VAYNTR-eSports-warzone-helper/"];
const previewOrigin = "https://nappygorilla.github.io";
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
const errors = [];

function addError(file, message) {
  errors.push(file + ": " + message);
}

// Guard against verified runtime regressions that syntax checks alone cannot catch.
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
if (/^\s*\$\("#primaryNav a"\)\.forEach/m.test(appSource)) {
  addError("app.js", "Use querySelectorAll for navigation link iteration.");
}
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
if (!serverSource.includes('.match(/^Bearer\\s+(.+)$/i)')) {
  addError("server.js", "Staff Authorization must parse Bearer followed by whitespace and a token.");
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

    if (target.origin === previewOrigin && target.pathname.startsWith(legacyProjectPrefix)) {
      addError(file, "Legacy project-site URL detected; use the root GitHub Pages URL instead: " + raw);
      continue;
    }

    const isExternalProjectPage = target.origin === previewOrigin &&
      externalProjectPrefixes.some((prefix) => target.pathname.startsWith(prefix));
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
