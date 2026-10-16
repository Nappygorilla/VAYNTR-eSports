# VAYNTR Esports

VAYNTR is an independent esports organization website focused on competition, player development, and team news. The public website is hosted on GitHub Pages.

## Project status

The public website is a static site. Recruitment submissions, member accounts, and staff actions should remain unavailable in the UI until the backend is configured, tested, and connected. Do not present sample data as live organization data.

## Render backend scaffold

The repository now includes an initial Node.js API for Render in `server.js`, a root `package.json`, and a Render Blueprint in `render.yaml`. The API includes health/status routes, member registration/login, recruitment application storage, and staff-only application review routes. See [Render backend setup](docs/render-backend.md).

The API is a scaffold, not a finished production account platform. It still needs a Render PostgreSQL database, generated `JWT_SECRET`, Render deployment, health verification, and frontend integration. Email verification, password recovery, session revocation, data retention/consent, and a safe staff-role workflow remain future requirements. Never commit credentials or put database secrets in browser code.

## Existing Supabase scaffold

Older membership invitation SQL and Edge Function files remain in `supabase/` during migration. They are not wired into the public UI. Do not deploy both systems for the same workflow; remove or archive the old scaffold only after the Render replacement has been verified.
