# VAYNTR Esports

VAYNTR is an independent esports organization website focused on competition, player development, and team news. The API runs on Render. The website is currently served at `https://nappygorilla.github.io/VAYNTR-eSports/`. Canonical URLs, the sitemap and social tags use that address. To move to the clean root URL, rename the repository to `nappygorilla.github.io`, then replace `/VAYNTR-eSports/` with `/` in the HTML, `sitemap.xml`, `robots.txt` and `scripts/check-site.js`. Search engines only read `robots.txt` and `sitemap.xml` from a domain root, so submit the sitemap URL in Google Search Console while the site lives under the project path.

## Public website

- The only public path to apply to join VAYNTR is \`recruitment.html\`.
- Recruitment requires a direct YouTube video link explaining why the applicant wants to join. Unlisted links are allowed; private videos may not be viewable by reviewers.
- Public news, match-result, and media feeds have client-side search and clear retry states; confirmed roster players have shareable public profile pages.
- Accepted members get an invite-gated account: the staff portal issues a one-time code bound to a roster member, and the member redeems it on `member.html` with their exact application name plus a hardened password (12+ chars, mixed classes). Sign-in is name + password and, when enabled, an authenticator-app MFA code; members manage their own public bio, age visibility, profile picture, social links and MFA from the portal. Staff access uses the private staff-review token.
- Recruitment requires the database and private staff-review token; email notifications are optional because the operator contacts applicants manually. The staff page has one-click Accept and Deny actions.

## Render backend

The Node.js API validates applications and YouTube video links, stores accepted players in PostgreSQL, and exposes protected staff tools. The protected `staff-applications.html` page is the staff portal: it has an overview dashboard, searchable recruitment queue, searchable roster/contact management, public player-profile editing, a database-backed Content Desk with searchable content records for news/results/media, and site-operations shortcuts. Accept adds a player to the database-backed public roster and deletes the application; Deny deletes the application without adding the applicant. Staff can compose manual email follow-ups, contact accepted players, and remove players from the public roster. Public roster responses never include email addresses. The public `roster.html` page loads approved players and public profile fields from the API. Staff can maintain public role, bio, HTTPS social/highlight URLs, and optional image URL. The `/api/news`, `/api/results`, and `/api/media` endpoints expose published content only; results additionally require staff verification. Drafts and all write actions are protected by staff authorization. Public About and Partnerships pages describe the organization without inventing partners, statistics, or results.

Before opening recruitment, check `/health` for `ok: true` and `database: connected`, and `/api/status` for `recruitmentApplications: true` and `staffReviewConfigured: true`. `emailNotifications: false` is expected while the operator sends emails manually.

## Content publishing and quality checks

Use the Content Desk in the staff portal to write a news item, add a match result, or publish an approved media link. Result entries are visible publicly only when both **Published** and **Verified** are enabled. Player contact emails remain staff-only; player profile fields are public. Use only HTTPS URLs and images the organization is allowed to display.

The GitHub Actions workflow runs `npm run check` on pushes to `main` and pull requests targeting `main`. This checks the configured JavaScript files and validates local links, anchor targets, duplicate IDs, ARIA references, and path-independent Results links. Before launch, review mobile layouts, contrast, keyboard navigation, feed behavior while the API is unavailable, roster profile links, and draft/publish/verify/delete flows against a test record. The sitemap and robots file cover public pages; the staff page is also marked `noindex,nofollow`, but the portal still depends on API authorization for data and actions.

## Secrets and privacy

Never commit API keys, staff access tokens, database credentials, or JWT secrets. Never put them in browser JavaScript. Application videos are represented by links; VAYNTR does not upload the video file itself. Review the privacy and recruitment policies before launch, including retention/deletion practices and age/guardian-consent rules where relevant.

## Legacy scaffold

Older Supabase membership-invitation files remain in \`supabase/\` during migration. They are not wired into the public site. Do not deploy both systems for the same workflow; remove or archive the old scaffold only after the Render workflow has been verified.


## Launch notes

- GitHub Pages publishes only the static site: the workflow copies the HTML, CSS, client JS and `assets/` into `dist/`. Server code, `docs/`, `supabase/` and config files are not published.
- Every page sets a Content Security Policy through a `<meta>` tag (GitHub Pages cannot send headers). If you add a new script, font host or API host, update the policy in every HTML file.
- `STAFF_REVIEW_TOKEN` is trimmed server-side, so a stray space or newline saved in Render no longer breaks sign-in. Use a random value of 48 or more characters and rotate it if it is ever shared.
- TLS to PostgreSQL verifies the server certificate by default (`PG_SSL_REJECT_UNAUTHORIZED` is no longer needed; set it to `false` only when the connection string's certificate cannot be validated, e.g. a custom CA). API-to-cloud-fit healthy check: `/health` reports `ok:false` and HTTP 503 unless the database is connected.
- The Render free plan sleeps when idle, so the first request can take up to a minute. Ping `/health` every 5–10 minutes with a free uptime monitor, or upgrade the plan.
- The recruitment form requires an age/guardian confirmation. Review the wording with your recruitment policy.
- The official Discord invite (`https://discord.gg/wBsrHpDxcP`) is published on `contact.html` and in the home-page footer. A staff-monitored email address and any other social accounts are still unpublished — add them only when a real account exists, and never as placeholders.

## Audit fixes and residual host limits (November 2026)

- `npm run check` now runs ESLint with `no-undef`. Syntax checks and source regexes cannot resolve identifiers, which is how an undeclared variable reached production; keep the lint step in CI.
- `security-check.js` now pins the fixes so they cannot silently regress: the recruitment insert serializes `socialLinks`, the member portal declares `memberState`, the member password minimum matches the API, the player profile renders one `h1`, and the avatar route sends an explicit CORP header.
- Member profile pictures are served with `Cross-Origin-Resource-Policy: cross-origin`. Helmet's same-origin default silently blocks the image when the GitHub Pages roster embeds it, so remove that header only if avatars stop being embedded cross-origin.
- `robots.txt` and `sitemap.xml` are only honoured at a domain root. While the site lives under `/VAYNTR-eSports/`, search engines will not read either file: rename the repository to `nappygorilla.github.io` or serve the site from a custom domain. The deploy workflow now stamps `lastmod` with the build date.
- GitHub Pages cannot send response headers. The `<meta>` CSP is the only policy available there and cannot declare `frame-ancestors`, so the public pages can still be framed. Put Cloudflare (or another proxy) in front of the site to add `frame-ancestors`, `X-Content-Type-Options` and `Referrer-Policy`.
- Pages now use the 4 KB SVG brand mark instead of the 136 KB PNG for on-page images (the PNG remains the favicon and social preview). Keep new artwork as SVG or WebP.
- `contact.html` routes visitors to the partnership form and recruitment instead of dead "link pending" placeholders. Replace those routes with real channels once the organization publishes them.

- Applicant path re-verified against `bb82e4f` on a throwaway database with a test reviewer: an anonymous
  application is stored (201) and every answer reads back through the staff queue; malformed JSON,
  bodyless and non-JSON requests, oversized fields and bad links return 400, an oversized body returns
  413; absent, forged and not-yet-verified staff sessions return 401/403; the test record was deleted
  afterwards. No request in that run returned a 500.
- Production deploys: on 2026-11-05 the Render service reported `autoDeploy: yes`, trigger `commit`,
  branch `main`, repo linked, and still created no deploy for three pushes to `main`
  (`bb82e4f`, `cff3777`, `67c0d8e`) — the only live build came from a manual API trigger. That is a
  GitHub-side webhook delivery failure, not a service-configuration one, so it can only be repaired
  from the Render dashboard. Two ways to get automatic delivery: reconnect the repository under the
  service's Settings (restores native auto-deploy), or add a `RENDER_DEPLOY_HOOK_URL` repository
  secret (Render -> service -> Settings -> Deploy Hook) for `.github/workflows/render-deploy.yml`,
  which now POSTs the hook on every API-affecting change and warns while the secret is missing.
- Fresh-database bootstrap: `mfa_challenges` declared a foreign key to `accounts` before `accounts` was created, so a first deploy against an empty database failed at startup with `relation "accounts" does not exist`. The schema now creates every table before anything references it, and `security-check.js` fails the build if a foreign key ever precedes its target table.

## Staff access: one-time migration (required before staff tools work again)

Staff tools no longer accept `STAFF_REVIEW_TOKEN`. Every staff action now requires an individual staff identity plus a 6-digit authenticator code, and every privileged action is written to `security_events` with that identity.

1. Deploy the backend, then open `staff-applications.html`.
2. Choose **First-time staff setup**. Enter `STAFF_REVIEW_TOKEN` as the setup key, plus your own email, display name, and a 12+ character password.
3. Scan the returned secret into an authenticator app and confirm one current code. That creates the `owner` identity and signs you in.
4. The setup key is now dead: `POST /api/staff/auth/bootstrap` returns 409 and the token grants nothing anywhere. Remove `STAFF_REVIEW_TOKEN` from Render once you are satisfied — nothing depends on it after migration.
5. Add other staff from inside the portal (owner/admin only). Each person receives their own secret and cannot use staff tools until they confirm a code.

Behaviour to expect:

- Sessions last 8 hours, are stored server-side as SHA-256 hashes, and are revoked by sign-out or by disabling the identity.
- Five failed attempts lock an identity with doubling cooldowns (5 → 10 → 20 → 40 → 60 minutes), separate from member lockouts.
- An authenticator code is single-use; replaying one is refused and recorded as `staff_mfa_replay`.
- Recruitment and partnership intake stay paused (HTTP 503) until at least one staff identity finishes two-factor setup, so applications cannot arrive where nobody can review them.
- `staffReviewConfigured` in `/api/status` now means "a staff identity exists with MFA enabled", not "a token is configured".
- If `JWT_SECRET` is missing, staff MFA setup refuses to run (503) rather than storing an unencrypted secret.
