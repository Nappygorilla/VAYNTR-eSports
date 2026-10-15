# VAYNTR Esports Website

A responsive, dark tactical website foundation for the VAYNTR esports organization. The initial build uses plain HTML, CSS, and JavaScript so it can run on GitHub Pages without a build step.

## Local preview

Open `index.html` in a modern browser, or run a local static server from the repository root.

## Included in this initial build

- VAYNTR-inspired crimson emblem, wordmark, and short animated boot sequence
- Responsive navigation, skip link, keyboard focus styles, and reduced-motion support
- Organization overview and multi-game division section
- Interactive local Warzone settings profile
- Meta/news editorial layouts with explicit unverified-data messaging
- Recruitment form interaction preview
- Responsive mobile/tablet/desktop styling
- GitHub Pages deployment workflow

## Important limitations

This is the first real repository implementation, not a finished full-stack platform. It currently has no server, database, real user accounts, authentication, admin dashboard, live meta integration, real roster feed, or secure application submission. The recruitment form is a front-end demonstration and must not be used to collect real personal information until a secure backend and privacy notice are implemented.

No players, sponsors, scores, achievements, social links, or current meta claims have been invented. Add real, approved information when available.

## GitHub Pages deployment

The included workflow publishes the repository root to GitHub Pages on pushes to `main`. In the repository's **Settings → Pages**, select **GitHub Actions** as the build/deployment source. The workflow runs on pushes to main and can also be started manually.

## Next milestones

1. Approve and refine the visual foundation.
2. Add dedicated roster, player profile, division, match, tournament, news, media, sponsor, and contact pages using verified organization information.
3. Choose and configure a backend/database for secure recruitment and account workflows.
4. Implement server-enforced role permissions and the admin dashboard.
5. Add automated tests, deployment checks, backups, privacy information, and production security review.
