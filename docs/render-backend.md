# VAYNTR Render backend

Node.js API for the static VAYNTR Esports site hosted on GitHub Pages. The Render web service runs \`node server.js\`; it uses PostgreSQL for application records and Resend for transactional email.

## Recruitment flow

- Public applications are submitted only through \`recruitment.html\`.
- The form requires the applicant's name, email, platform, game/division, consent checkbox, and a direct YouTube video link explaining why they want to join VAYNTR. Unlisted videos are accepted; private videos may not be accessible to reviewers.
- The API validates supported YouTube video URL formats on the server before saving the application.
- \`POST /api/recruitment/applications\` stores the application, then attempts a branded confirmation email.
- \`GET /api/staff/applications\` lists recent submissions and YouTube links; \`POST /api/staff/applications/:id/status\` changes status and sends an email when the status becomes \`accepted\` or \`declined\`.
- Status updates are protected by a staff access token or a pre-existing staff/admin JWT. The unlinked \`staff-applications.html\` screen is not linked from the public navigation and only displays application data after the API authorizes it.
- The former public login, registration, and member-dashboard pages are not part of the intended public site. Account endpoints remain in the backend for any existing staff/admin JWTs but do not accept or approve recruitment applications.

## Render environment variables

- \`DATABASE_URL\`: connection string for the VAYNTR PostgreSQL database.
- \`JWT_SECRET\`: legacy JWT secret, at least 32 characters, for any existing staff/admin JWTs.
- \`FRONTEND_ORIGINS=https://nappygorilla.github.io\`: allowed browser origin. Add your custom website origin if one is configured later.
- \`RESEND_API_KEY\`: secret API key from Resend.
- \`RESEND_FROM_EMAIL\`: sender in the form \`VAYNTR Esports <recruitment@yourdomain.com>\`. The domain must be verified in Resend. Do not set this to an address on a domain you do not control.
- \`RESEND_REPLY_TO\`: optional reply-to address.
- \`STAFF_REVIEW_TOKEN\`: private, high-entropy random secret, at least 32 characters. Set it in Render Environment and enter the same value on the unlinked \`staff-applications.html\` page. Never commit it or share it publicly.

Never expose \`RESEND_API_KEY\`, \`STAFF_REVIEW_TOKEN\`, database credentials, or \`JWT_SECRET\` in public JavaScript, URLs, source files, screenshots, or GitHub. If any secret is exposed, rotate it.

## Database setup and migrations

On startup the API creates the application table if needed and adds the YouTube/email-notification columns to existing installations. This is designed to preserve existing applications while adding the new fields.

Use a database connection string that the service can actually reach. Render's internal database URLs are intended for services in the same region; the VAYNTR web service and database must be configured consistently or use the correct connection method. Check \`GET /health\` and require \`ok: true\` and \`database: connected\` before opening recruitment.

## Email delivery

The API calls Resend from the backend only. A successful application is saved even if email delivery is temporarily unavailable; the response and staff screen make that limitation visible. Decision email attempts are tracked to avoid sending the same successful decision notification repeatedly. If a message fails because configuration is missing or Resend rejects it, correct the sender/API setup and save the terminal decision again to retry.

The email sender does not use a placeholder address automatically. Until \`RESEND_FROM_EMAIL\` is configured with a verified sending domain, application and decision records can be saved, but email notifications will report as not sent.

## Current limits and safety

- The API uses rate limits and CORS restrictions, validates required fields and direct video URLs, and relies on protected staff routes for private application review.
- YouTube links must point directly to a video. Channel, playlist, or arbitrary external URLs are rejected.
- Do not collect sensitive personal data in the application or video.
- Review the privacy and recruitment policies before launch, including retention/deletion practices and age/guardian-consent rules where relevant.
- A live Render deployment is not proof of end-to-end readiness. Test the database connection, application submission, staff review authorization, confirmation email, approval email, denial email, and notification failure states before announcing recruitment as open.
