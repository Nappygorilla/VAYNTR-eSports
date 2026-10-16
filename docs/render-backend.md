# VAYNTR Render backend

Initial Node.js API for Render. Configure a Render Web Service from this repository on branch `main`, runtime Node, build `npm install`, start `npm start`, health check `/health`.

## Endpoints
- `GET /health`
- `GET /api/status`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/recruitment/applications`
- `GET /api/staff/applications` (staff/admin only)
- `POST /api/staff/applications/:id/status` (staff/admin only)

## Required Render environment
- `DATABASE_URL`: internal connection string from a Render PostgreSQL database in the same region.
- `JWT_SECRET`: randomly generated secret at least 32 characters; never share it or commit it.
- `FRONTEND_ORIGINS=https://nappygorilla.github.io` (origin only, no page path).

The service creates the initial tables at startup. Verify `/health` returns `ok: true` and `database: connected`. Registration always creates the `member` role; no public role assignment exists.

## Not finished yet
The API is not connected to the website forms/dashboard. Email verification, password reset, session revocation, application retention/consent, and a safe staff-role workflow are still needed before production. Keep recruitment closed until the form is integrated and a real review process exists. Leave the old Supabase scaffold untouched until the Render API is verified.