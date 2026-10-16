# VAYNTR Esports

VAYNTR is an independent esports organization website focused on competition, player development, and team news. The public website is hosted on GitHub Pages and the API runs on Render.

## Public website

- The only public path to apply to join VAYNTR is \`recruitment.html\`.
- Recruitment requires a direct YouTube video link explaining why the applicant wants to join. Unlisted links are allowed; private videos may not be viewable by reviewers.
- Public sign-in, registration, and member-dashboard pages have been removed. Public account registration is disabled in the API unless an operator explicitly enables it.
- The form remains paused until the database and private staff-review token are configured. Branded email notifications are optional; applications can still be received and reviewed if Resend is not ready.

## Render backend

The Node.js API is in \`server.js\`. It validates and stores recruitment applications, validates YouTube video links, sends branded transactional emails through Resend, and exposes staff-only review endpoints. The unlinked \`staff-applications.html\` page lets authorized staff review applications, open the submitted video, set a status, and retry a failed confirmation email.

Before announcing recruitment as open, configure the environment in Render and follow [docs/render-backend.md](docs/render-backend.md). Check \`GET /health\` for \`ok: true\` and \`database: connected\`, and \`GET /api/status\` for \`emailNotifications: true\` and \`staffReviewConfigured: true\`. `emailNotifications: false` means automatic emails are unavailable, not that applications are blocked.

## Secrets and privacy

Never commit API keys, staff access tokens, database credentials, or JWT secrets. Never put them in browser JavaScript. Application videos are represented by links; VAYNTR does not upload the video file itself. Review the privacy and recruitment policies before launch, including retention/deletion practices and age/guardian-consent rules where relevant.

## Legacy scaffold

Older Supabase membership-invitation files remain in \`supabase/\` during migration. They are not wired into the public site. Do not deploy both systems for the same workflow; remove or archive the old scaffold only after the Render workflow has been verified.
