---
id: reference-completed-2026-05-22-scout-conversion-tracking
type: reference
status: complete
board: false
---

# Simple Scout Conversion Tracking

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

## Summary

Browser-side Pinterest and Reddit conversion tracking is implemented with
required production pixel configuration, consent-gated pixel loading, tracked
Discord install CTAs, and Buildkite deploy wiring. The remaining post-merge
operator action is to register the documented Temporal follow-up from `main` and
confirm page-view plus `Lead` events in the Pinterest and Reddit dashboards
after production deploy.
