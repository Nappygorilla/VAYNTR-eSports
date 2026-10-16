# VAYNTR Esports

VAYNTR is an independent esports organization website focused on competition, player development, and team news. The public website is hosted on GitHub Pages and the API runs on Render.

## Public website

- The only public path to apply to join VAYNTR is \`recruitment.html\`.
- Recruitment requires a direct YouTube video link explaining why the applicant wants to join. Unlisted links are allowed; private videos may not be viewable by reviewers.
- Public sign-in, registration, and member-dashboard pages have been removed. Public account registration is disabled in the API unless an operator explicitly enables it.
- Recruitment requires the database and private staff-review token; email notifications are optional because the operator contacts applicants manually. The staff page has one-click Accept and Deny actions.

## Render backend

The Node.js API validates applications and YouTube video links, stores accepted players in PostgreSQL, and exposes protected staff tools. In `staff-applications.html`, Accept adds a player to the database-backed public roster and deletes the application; Deny deletes the application without adding the applicant. Accepted player email addresses remain visible only in the protected staff roster for manual contact. The public `roster.html` page loads approved players from the API without exposing email addresses.

Before opening recruitment, check `/health` for `ok: true` and `database: connected`, and `/api/status` for `recruitmentApplications: true` and `staffReviewConfigured: true`. `emailNotifications: false` is expected while the operator sends emails manually.

## Secrets and privacy

Never commit API keys, staff access tokens, database credentials, or JWT secrets. Never put them in browser JavaScript. Application videos are represented by links; VAYNTR does not upload the video file itself. Review the privacy and recruitment policies before launch, including retention/deletion practices and age/guardian-consent rules where relevant.

## Legacy scaffold

Older Supabase membership-invitation files remain in \`supabase/\` during migration. They are not wired into the public site. Do not deploy both systems for the same workflow; remove or archive the old scaffold only after the Render workflow has been verified.
