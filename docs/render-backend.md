# VAYNTR Render backend

Node.js API for the static VAYNTR Esports site hosted on GitHub Pages. The Render web service runs \`node server.js\`; it uses PostgreSQL for application records and Resend for transactional email.

## Recruitment flow

- Public applications are submitted only through \`recruitment.html\`.
- The form requires the applicant's name, email, platform, game/division, consent checkbox, and a direct YouTube video link explaining why they want to join VAYNTR. Unlisted videos are accepted; private videos may not be accessible to reviewers.
- The API validates supported YouTube video URL formats on the server before saving the application.
- \`POST /api/recruitment/applications\` validates and stores the application, then marks contact as manual; it does not send a confirmation email.
- \`GET /api/staff/applications\` lists pending submissions and YouTube links. \`POST /api/staff/applications/:id/decision\` accepts or denies an application in a database transaction. Accept copies the applicant's display name, email, platform, and game into \`roster_players\` and deletes the application; deny deletes the application without creating a roster entry. No email is sent by this decision endpoint. \`GET /api/roster\` returns public-safe player details; \`GET /api/staff/roster\` is protected and includes email addresses for manual contact. The protected `staff-applications.html` screen is the staff portal with Overview, Applications, Roster & contacts, and Site operations tabs. `POST /api/staff/roster/:id/remove` is staff-only and removes a confirmed player plus their private contact record from the roster after a confirmation prompt.
- Status updates are protected by a staff access token or a pre-existing staff/admin JWT. The unlinked \`staff-applications.html\` screen is not linked from the public navigation and only displays application data after the API authorizes it.
- The former public login, registration, and member-dashboard pages are not part of the intended public site. Public account registration returns 404 unless `ENABLE_PUBLIC_REGISTRATION=true`; leave this unset. Existing staff/admin JWTs may still access staff routes, but the preferred staff console uses `STAFF_REVIEW_TOKEN`.

## Render environment variables

- \`DATABASE_URL\`: connection string for the VAYNTR PostgreSQL database.
- \`JWT_SECRET\`: legacy JWT secret, at least 32 characters, for any existing staff/admin JWTs.
- \`FRONTEND_ORIGINS=https://nappygorilla.github.io\`: allowed browser origin. Add your custom website origin if one is configured later.
- \`RESEND_API_KEY\`: optional secret API key from Resend. Without it, applications and status changes still work, but automatic emails are skipped.
- \`RESEND_FROM_EMAIL\`: sender in the form \`VAYNTR Esports <recruitment@yourdomain.com>\`. The domain must be verified in Resend. Do not set this to an address on a domain you do not control.
- \`RESEND_REPLY_TO\`: optional reply-to address.
- \`STAFF_REVIEW_TOKEN\`: private, high-entropy random secret, at least 32 characters. Set it in Render Environment and enter the same value on the unlinked \`staff-applications.html\` page. Never commit it or share it publicly.

Never expose \`RESEND_API_KEY\`, \`STAFF_REVIEW_TOKEN\`, database credentials, or \`JWT_SECRET\` in public JavaScript, URLs, source files, screenshots, or GitHub. If any secret is exposed, rotate it.

## Database setup and migrations

On startup the API creates the application table if needed and adds the YouTube/email-notification columns to existing installations. This is designed to preserve existing applications while adding the new fields.

Use a database connection string that the service can actually reach. Render's internal database URLs are intended for services in the same region; the VAYNTR web service and database must be configured consistently or use the correct connection method. Check \`GET /health\` and require \`ok: true\` and \`database: connected\` before opening recruitment. Resend is optional; recruitment remains usable without email notifications.

## Email delivery

The operator currently sends applicant and decision emails manually. The Accept/Deny controls do not send emails. The accepted player's email is retained only in the staff-protected roster contact list, and the public roster endpoint never returns email addresses. Resend support remains optional for future use.

The email sender does not use a placeholder address automatically. Until \`RESEND_FROM_EMAIL\` is configured with a verified sending domain, application and decision records can be saved, but email notifications will report as not sent.

## Current limits and safety

- The API uses rate limits and CORS restrictions, validates required fields and direct video URLs, and relies on protected staff routes for private application review.
- YouTube links must point directly to a video. Channel, playlist, or arbitrary external URLs are rejected.
- Do not collect sensitive personal data in the application or video.
- Review the privacy and recruitment policies before launch, including retention/deletion practices and age/guardian-consent rules where relevant.
- A live Render deployment is not proof of end-to-end readiness. Test the database connection, application submission, staff review authorization, confirmation email, approval email, denial email, and notification failure states before announcing recruitment as open.
