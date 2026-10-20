# VAYNTR Render backend

Node.js API for the static VAYNTR Esports site hosted on GitHub Pages. The Render web service runs \`node server.js\`; it uses PostgreSQL for application records and Resend for transactional email.

## Recruitment flow

- Public applications are submitted only through \`recruitment.html\`.
- The form requires the applicant's name, email, platform, game/division, consent checkbox, and a direct YouTube video link explaining why they want to join VAYNTR. Unlisted videos are accepted; private videos may not be accessible to reviewers.
- The API validates supported YouTube video URL formats on the server before saving the application.
- \`POST /api/recruitment/applications\` validates and stores the application, then marks contact as manual; it does not send a confirmation email.
- \`GET /api/staff/applications\` lists pending submissions and YouTube links. \`POST /api/staff/applications/:id/decision\` accepts or denies an application in a database transaction. Accept copies the applicant's display name, email, platform, game, recorded age, and their public-age consent into \`roster_players\` and deletes the application; deny deletes the application without creating a roster entry. \`GET /api/roster\` returns the age only when the player consented via \`show_age_on_profile\`; staff can edit the age and that consent through \`POST /api/staff/roster/:id/update\`. No email is sent by this decision endpoint. \`GET /api/roster\` returns public-safe player details; \`GET /api/staff/roster\` is protected and includes email addresses for manual contact. The protected `staff-applications.html` screen is the staff portal with Overview, Applications, Roster & contacts, and Site operations tabs. `POST /api/staff/roster/:id/remove` is staff-only and removes a confirmed player plus their private contact record from the roster after a confirmation prompt.
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

## Member account security (current)

- **MFA (TOTP)**: members enroll an authenticator app from member.html (`POST /api/me/mfa/enroll` → secret + otpauth URI; the secret is stored AES-256-GCM encrypted, keyed from `JWT_SECRET`). Activation (`.../activate`) and disable (`.../disable`) both require a current code. When enabled, every sign-in requires a second step: the password stage returns a short-lived hashed `mfaToken` (`mfa_challenges`, 5 min), verified at `POST /api/accounts/login/verify` (failed verifications rate-limited 6/15 min).
- **Account lockout**: 5 failed passwords auto-lock the account; the cooldown doubles with repeated lockouts (5 → 10 → 20 → 40 → capped 60 min) and resets on a successful sign-in.
- **Proof-of-work**: after 2 recent failed attempts (per account or per IP, IPs hashed in memory), the login response carries a hashcash challenge (~16 zero bits of SHA-256); the member page solves it in-browser and the solution is verified server-side.
- **Password policy**: 12+ characters with upper/lowercase, digit, and symbol; a blocklist of common passwords (including leetspeak variants) is enforced for every registration.
- **Security events**: `security_events` records failed logins, lockouts, MFA failures/enrolls, and successful sign-ins with truncated SHA-256 IP hashes. Staff review them under Site operations (`GET /api/staff/security-events`). Nothing here is exposed publicly.

## Member accounts (current)

Applications carry an optional track (`player` or `media team`) and up to three HTTPS social links; accepting copies the social links and member type onto the roster record automatically, and media applicants must include at least one social link. Staff issue a player invite from the roster card (`POST /api/staff/invites/for-roster/:id`), which binds the one-time code to that roster member. The member redeems it at `POST /api/accounts/register` with the code, their exact application/roster name (case-insensitive match), and a password; the backend stores only a salted scrypt hash, and sessions are random 7-day tokens persisted as SHA-256 hashes (`account_sessions`). `POST /api/accounts/login` signs in with name + password (failed logins are rate-limited); `GET /api/me` and `POST /api/me/social-links` are Bearer-session protected and let members review their own profile and update up to 3 public social links; `POST /api/accounts/logout` deletes the session server-side. Removing a roster player cascades to the account and its sessions. Staff profile edits keep the sign-in name in sync and save the social-links editor (one HTTPS link per line, folded into both `social_links` and the legacy `social_url` column).

Members also manage their public presentation self-service. All Bearer-session protected: `POST /api/me/profile` edits the public bio (up to 500 characters) and the age-visibility toggle on the roster record; `POST /api/me/avatar` uploads a profile picture as raw bytes (PNG/JPEG/WebP only, validated by magic bytes, capped at 300 KB) stored in the roster_players.avatar_data BYTEA column; `DELETE /api/me/avatar` removes it; `GET /api/members/:id/avatar` serves the picture publicly with short caching, which the roster and player pages prefer over external artwork (has_avatar flags it in the roster payload). Avatar writes count toward the account rate limit and are recorded in security_events.

The email sender does not use a placeholder address automatically. Until \`RESEND_FROM_EMAIL\` is configured with a verified sending domain, application and decision records can be saved, but email notifications will report as not sent.

## Keep-alive

The free Render tier sleeps the backend after idle time. `.github/workflows/keep-alive.yml` pings `https://vayntr-esports.onrender.com/health` every 10 minutes (GitHub Actions cron), keeping the service warm so visitor requests do not cold-start it. It only performs health pings; no credentials are needed for the public endpoint.

## Current limits and safety

- The API uses rate limits and CORS restrictions, validates required fields and direct video URLs, and relies on protected staff routes for private application review.
- YouTube links must point directly to a video. Channel, playlist, or arbitrary external URLs are rejected.
- Do not collect sensitive personal data in the application or video.
- Review the privacy and recruitment policies before launch, including retention/deletion practices and age/guardian-consent rules where relevant.
- A live Render deployment is not proof of end-to-end readiness. Test the database connection, application submission, staff review authorization, confirmation email, approval email, denial email, and notification failure states before announcing recruitment as open.
