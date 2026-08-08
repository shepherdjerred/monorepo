---
id: plan-2026-07-26-scout-app-analytics-instrumentation
type: plan
status: in-progress
board: true
verification: operator
disposition: blocked
---

# Scout product analytics on Matomo

## Context

The Scout SPA and marketing site use self-hosted Matomo for product and marketing
analytics. Production and beta have separate Matomo sites; local builds omit the
site identity and do not send pageviews.

Tracking is cookieless and privacy-first. Dynamic routes are normalized before
tracking, and only bounded properties are mapped to Matomo Custom Dimensions.
Guild IDs, Riot IDs, aliases, query contents, and conversion UUIDs are excluded.

## Design

- `app/src/lib/analytics.ts` owns the Matomo queue, manual SPA pageviews, event
  dispatch, outbound navigation flushing, route normalization, and mutation-result
  dimensions.
- `VITE_MATOMO_SITE_ID` and `VITE_MATOMO_SITE_DOMAIN` are injected by the Scout
  release script from `config/analytics-sites.json`.
- Scout events use category `scout`; the bounded properties map to eight event-scoped
  Custom Dimensions.
- The marketing site uses `PUBLIC_MATOMO_SITE_ID` and records conversion events
  without the UUID used only for advertising-pixel deduplication.

## Registry bootstrap

Create these Matomo sites during the first-run cutover and keep their numeric
IDs synchronized with `config/analytics-sites.json`:

| Site ID | Hostname                       |
| ------: | ------------------------------ |
|       1 | `sjer.red`                     |
|       2 | `resume.sjer.red`              |
|       3 | `webring.sjer.red`             |
|       4 | `better-skill-capped.com`      |
|       5 | `discord-plays-mario-kart.com` |
|       6 | `discord-plays-pokemon.com`    |
|       7 | `scout-for-lol.com`            |
|       8 | `beta.scout-for-lol.com`       |

Configure Custom Dimensions 1–8 as event-scoped dimensions named
`outcome`, `reason`, `kind`, `category`, `preference`, `action`, `step`, and
`has_existing_query`, respectively.

## Operator prerequisites

- [ ] Matomo is available at `https://matomo.sjer.red`.
- [ ] All eight registry sites are configured with the IDs recorded above.
- [ ] Custom Dimensions 1–8 are configured for Scout event properties.
- [ ] IP anonymization, Do Not Track support, no User IDs, and cookie disabling
      are enabled in Matomo privacy settings.
- [ ] Browser archiving is disabled and the archive worker is healthy.

## Verification

- [ ] Run focused Scout app/frontend tests, typechecks, lint, and builds.
- [ ] Confirm production and beta pageviews use site IDs 7 and 8 respectively.
- [ ] Confirm normalized SPA routes never include raw identifiers or query strings.
- [ ] Confirm Scout events and dimensions appear in Matomo real-time reports.
- [ ] Confirm marketing conversion events include `cta_location` but not `event_id`.

## Remaining

- [ ] Publish and sync the Matomo GitOps resources.
- [ ] Initialize Matomo sites, privacy settings, and Custom Dimensions.
- [ ] Release the affected sites and Scout production/beta together.
- [ ] Smoke-test pageviews, SPA navigation, events, dimensions, and persistence.
- [ ] Remove the live Plausible namespace and persistent volumes after smoke testing.
