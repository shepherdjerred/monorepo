# Simple Scout Conversion Tracking

## Status

Partially Complete

## Scope

Add browser-side Pinterest and Reddit conversion tracking to the Scout for League
of Legends marketing site.

## Accepted Constraints

- Require `PUBLIC_PINTEREST_TAG_ID` and `PUBLIC_REDDIT_PIXEL_ID`.
- Fail fast when either tracking ID is missing or blank.
- Track page views and outbound Discord install clicks only.
- Do not add PostHog, server-side conversions APIs, OAuth callback attribution,
  bot lifecycle attribution, or new marketing-attribution database tables.

## Implementation Notes

- Centralize the Discord OAuth invite URL.
- Load Pinterest and Reddit pixels globally from the frontend layout.
- Track Add Scout/Add to Discord CTA clicks with CTA location metadata.
- Update the privacy policy to disclose advertising measurement and web tracking.

## Session Log — 2026-05-22

### Done

- Added Astro env schema entries for `PUBLIC_PINTEREST_TAG_ID` and
  `PUBLIC_REDDIT_PIXEL_ID`.
- Added Scout marketing config and global Pinterest/Reddit browser pixel loader.
- Added page-view tracking and outbound Discord install click tracking for
  Pinterest `Lead`, Reddit `Lead`, and internal `discord_install_click` events.
- Centralized the Discord OAuth invite URL and tagged navbar, home hero, home
  final CTA, getting started, docs, and whatsnew CTAs with location metadata.
- Updated the Scout privacy policy to disclose advertising measurement, cookies,
  and web tracking.
- Verified frontend `typecheck`, `lint`, `build`, and missing-env build failure.
- Updated the Buildkite static-site deploy step to forward Scout's required
  public pixel env vars from `buildkite-ci-secrets` into the Dagger build
  container.
- Added `PUBLIC_REDDIT_PIXEL_ID` to the 1Password item backing
  `buildkite-ci-secrets`.
- Added `PUBLIC_PINTEREST_TAG_ID` to the 1Password item backing
  `buildkite-ci-secrets`.
- Addressed Greptile review comments by avoiding an unhandled analytics click
  exception and moving Discord CTA constants into an env-free module shared by
  Astro and React components.
- Verified `scripts/ci` tests and typecheck, plus `.dagger` TypeScript
  typecheck after regenerating the ignored Dagger SDK.
- Rebased the PR onto current `main` with no conflicts and updated CI dry-run
  site deploys to use explicit development placeholder pixel IDs, while
  production deploys still require the real Buildkite secrets.

### Remaining

<!-- temporal-agent-task
{
  "title": "Verify Scout Pinterest and Reddit conversion dashboards",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-30T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/plans/2026-05-22_scout-conversion-tracking.md"
  },
  "prompt": "Verify Pinterest and Reddit page view and Lead events after Scout production deploy."
}
-->

- Confirm events appear in Pinterest/Reddit dashboards after deployment.

### Caveats

- Browser plugin preview smoke testing was blocked by the in-app browser after
  the final build; generated HTML inspection confirmed the pixel loaders and CTA
  markers are present.
- Scout backend codegen was needed before frontend typecheck could complete in
  this fresh checkout; the generate script itself failed later on a missing
  `prettier-plugin-astro`, but the generated Prisma client was sufficient for
  frontend verification.
- Direct 1Password verification from this workspace was blocked because
  `op whoami` could not connect to the 1Password desktop app. The Reddit and
  Pinterest pixel IDs were added manually after that attempt.
- PR dry-run deploy builds use explicit `dev-*` public pixel IDs so CI can
  validate the frontend build without requiring production ad pixel secrets;
  main/prod deploys still require the real Buildkite secret values.

## Session Log — 2026-05-23

### Done

- Rebased PR #866 onto the latest `main` with no merge conflicts.
- Addressed follow-up CodeRabbit comments by requiring paired tracking props in
  Scout button components, standardizing the `getting-started` CTA location, and
  adding a `temporal-agent-task` block for dashboard verification.
- Rebased onto the latest `main`, resolved Scout homepage/privacy policy
  conflicts, added consent gating for Pinterest/Reddit pixels, and made the
  Scout deploy env-var pipeline test deterministic.
- Verified Scout frontend `typecheck`, `lint`, and `build` with development
  placeholder Pinterest/Reddit pixel IDs.

### Remaining

- Confirm Pinterest and Reddit dashboards show page-view and `Lead` events after
  the tracking changes are deployed to production.

### Caveats

- The temporal follow-up is documented in this plan; it still needs to be
  registered from `main` after the PR lands.

## Summary

Browser-side Pinterest and Reddit conversion tracking is implemented with
required production pixel configuration, consent-gated pixel loading, tracked
Discord install CTAs, and Buildkite deploy wiring. The remaining post-merge
operator action is to register the documented Temporal follow-up from `main` and
confirm page-view plus `Lead` events in the Pinterest and Reddit dashboards
after production deploy.
