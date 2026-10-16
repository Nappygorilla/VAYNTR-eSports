# VAYNTR Esports

VAYNTR is an independent esports organization website focused on competition, player development, and team news. The public website is hosted on GitHub Pages and the API runs on Render.

## Public website

- The only public path to apply to join VAYNTR is \`recruitment.html\`.
- Recruitment requires a direct YouTube video link explaining why the applicant wants to join. Unlisted links are allowed; private videos may not be viewable by reviewers.
- Public sign-in, registration, and member-dashboard pages have been removed. The API does not expose public account login or registration endpoints; staff access uses the private staff-review token.
- Recruitment requires the database and private staff-review token; email notifications are optional because the operator contacts applicants manually. The staff page has one-click Accept and Deny actions.

## Render backend

The Node.js API validates applications and YouTube video links, stores accepted players in PostgreSQL, and exposes protected staff tools. The protected `staff-applications.html` page is the staff portal: it has an overview dashboard, recruitment queue, public player-profile editing, roster/contact management, a database-backed Content Desk for news/results/media, and site-operations shortcuts. Accept adds a player to the database-backed public roster and deletes the application; Deny deletes the application without adding the applicant. Staff can compose manual email follow-ups, contact accepted players, and remove players from the public roster. Public roster responses never include email addresses. The public `roster.html` page loads approved players and public profile fields from the API. Staff can maintain public role, bio, HTTPS social/highlight URLs, and optional image URL. The `/api/news`, `/api/results`, and `/api/media` endpoints expose published content only; results additionally require staff verification. Drafts and all write actions are protected by staff authorization. Public About and Partnerships pages describe the organization without inventing partners, statistics, or results.

Before opening recruitment, check `/health` for `ok: true` and `database: connected`, and `/api/status` for `recruitmentApplications: true` and `staffReviewConfigured: true`. `emailNotifications: false` is expected while the operator sends emails manually.

## Content publishing and quality checks

Use the Content Desk in the staff portal to write a news item, add a match result, or publish an approved media link. Result entries are visible publicly only when both **Published** and **Verified** are enabled. Player contact emails remain staff-only; player profile fields are public. Use only HTTPS URLs and images the organization is allowed to display.

The GitHub Actions workflow runs `npm run check` on pushes to `main` and pull requests targeting `main`. This checks the configured JavaScript files and validates local links, anchor targets, duplicate IDs, ARIA references, and Results URL handling. Before launch, review mobile layouts, contrast, keyboard navigation, feed behavior while the API is unavailable, roster profile links, and draft/publish/verify/delete flows against a test record. The sitemap and robots file cover public pages; the staff page is also marked `noindex,nofollow`, but the portal still depends on API authorization for data and actions.

## Secrets and privacy

Never commit API keys, staff access tokens, database credentials, or JWT secrets. Never put them in browser JavaScript. Application videos are represented by links; VAYNTR does not upload the video file itself. Review the privacy and recruitment policies before launch, including retention/deletion practices and age/guardian-consent rules where relevant.

## Legacy scaffold

Older Supabase membership-invitation files remain in \`supabase/\` during migration. They are not wired into the public site. Do not deploy both systems for the same workflow; remove or archive the old scaffold only after the Render workflow has been verified.
