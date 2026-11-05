"use strict";

// The project's existing checks are syntax checks and source regexes; neither resolves
// identifiers, so a misspelled variable could reach production as a runtime ReferenceError.
// `no-undef` is the check that catches that class of bug.
//
// The rules are applied to every JavaScript file on purpose. ESLint silently skips any file
// that no config object matches, so an explicit allow-list would leave new scripts unchecked.
const globals = require("globals");

const rules = {
  "no-undef": "error",
  // Express only recognises an error middleware by its four parameters, so the unused
  // trailing `next` is required there; the leading-underscore convention marks that intent.
  "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", caughtErrors: "none" }]
};

const nodeSources = ["server.js", "security-check.js", "eslint.config.js", "scripts/**/*.js"];

module.exports = [
  { ignores: ["node_modules/**", "dist/**", "assets/**", "supabase/**"] },
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2023 },
    rules
  },
  {
    files: nodeSources,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: globals.node
    }
  },
  {
    files: ["*.js"],
    ignores: nodeSources,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: globals.browser
    }
  }
];
