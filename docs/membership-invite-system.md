# VAYNTR membership invitation system

## Status

This is a backend implementation scaffold, not a production-ready member portal. It adds the database migration and three Supabase Edge Functions. The current GitHub Pages code remains a demo: it does not authenticate members or call these functions. Do not collect real personal data or advertise member access as active until the deployment and checks below are complete.

## Behavior

- Staff/admin issue a cryptographically random, one-time invite.
- The plaintext code is returned only when created. The database stores a SHA-256 hash, not the code.
- Codes expire 30 days after issuance.
- Redemption requires an authenticated Supabase user and is performed atomically in PostgreSQL.
- Successful redemption changes the user's profile from `user/none` to `member/active`.
- Revocation is staff/admin-only and applies to unused invitations. Already redeemed codes are spent; member account suspension/revocation should be a separate audited staff action.
- Redemption is limited to 10 attempts per authenticated user per rolling 15-minute window. The database serializes the check to avoid concurrent bypass.
- Unknown, expired, revoked, and already-used codes return the same public error.

## Files

- `supabase/migrations/202610150001_membership_invites.sql`
- `supabase/functions/issue-invite/index.ts`
- `supabase/functions/redeem-invite/index.ts`
- `supabase/functions/revoke-invite/index.ts`

## Deployment

1. Install the Supabase CLI and authenticate it.
2. Link the CLI to the correct Supabase project; verify the project ref before applying anything.
3. Review the migration, then run `supabase db push` (or apply the migration through the SQL editor after reviewing it).
4. Deploy the three functions:
   - `supabase functions deploy issue-invite`
   - `supabase functions deploy redeem-invite`
   - `supabase functions deploy revoke-invite`
5. Confirm Edge Function JWT verification remains enabled. These functions also explicitly validate the caller with Supabase Auth.
6. Configure Auth sign-up/login, email verification if required, session persistence, password recovery, and account deletion policy before using invitations.
7. Assign the first trusted staff account's `profiles.role` to `staff` through the Supabase SQL editor as project owner. Do not create a browser UI that lets users assign themselves staff/admin.
8. Keep the Supabase service-role key only in Supabase's server-side function secrets. Never commit it, embed it in HTML/JS, or send it to a browser. The existing public publishable key is not a substitute for backend authorization.
9. Configure production CORS to allow only the actual VAYNTR website origins instead of `*`, once the final domains are known.
10. Test with disposable accounts and test invitations before launch.

## API contracts

All calls use HTTPS POST and an authenticated Supabase access token in `Authorization: Bearer <access_token>`.

### Issue invitation

`POST /functions/v1/issue-invite`

Body: `{"label":"Optional internal note"}`

Requires profile role `staff` or `admin`. Returns the code exactly once, along with an invitation ID and expiry timestamp. Store or deliver the plaintext securely; it cannot be recovered from the database.

### Redeem invitation

`POST /functions/v1/redeem-invite`

Body: `{"code":"VAYNTR-..."}`

Requires a signed-in account whose profile is still `user/none`. The user ID comes from the validated access token, never from the request body. Successful redemption is atomic and binds the code to that account.

### Revoke invitation

`POST /functions/v1/revoke-invite`

Body: `{"inviteId":"<uuid>"}`

Requires profile role `staff` or `admin`. Only an unused, unrevoked invitation can be revoked.

## RLS and permission model

- `profiles`: authenticated users can select their own row only. There is no client-side update policy, so a user cannot change their own role or membership status.
- `invite_codes` and `invite_attempts`: RLS is enabled and there are no browser-facing policies or grants.
- Privileged SQL RPCs are executable only by `service_role`; Edge Functions use that credential server-side after validating the user's identity and staff role.
- Profile role changes and membership status changes must be performed only through trusted server-side code or a project-owner-controlled SQL session.
- Do not rely on hiding links or buttons as access control. Any future member-only API/data must enforce `profiles.membership_status = 'active'` on the server or in RLS.

## Rate limiting and operational hardening

The included limit is per authenticated user: 10 attempts per rolling 15 minutes. Before production, add edge/IP-based abuse controls using trusted platform-provided client metadata (never trust a client-supplied IP header), monitoring/alerts, and retention cleanup for old `invite_attempts` rows. Avoid logging raw invitation codes, access tokens, or sensitive user data.

## Required production checks

- Confirm database migration and all functions deployed to the intended project.
- Test expired, revoked, malformed, unknown, already-used, and concurrently redeemed codes.
- Confirm a second account cannot redeem a spent code.
- Confirm normal users receive 403 from issue/revoke endpoints.
- Confirm users cannot read invite tables or modify their own role/status using the anon/publishable key.
- Confirm revoked invitations fail even if the user knows the original code.
- Confirm the app doesn't expose service-role credentials in any GitHub Pages asset.
- Add a separate authenticated UI only after auth is implemented; until then the website should continue to state that member verification is unavailable.
