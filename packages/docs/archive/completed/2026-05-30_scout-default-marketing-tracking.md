---
id: reference-completed-2026-05-30-scout-default-marketing-tracking
type: reference
status: complete
board: false
---

# Scout Default Marketing Tracking

## Summary

Remove the Scout marketing consent popup and enable Pinterest/Reddit marketing
tracking by default on the marketing site. Keep the existing required
`PUBLIC_PINTEREST_TAG_ID` and `PUBLIC_REDDIT_PIXEL_ID` environment variables,
Plausible/Sentry behavior, and Discord CTA event names/locations.

## Implementation Plan

- Remove the marketing consent state and UI from
  `packages/scout-for-lol/packages/frontend/src/components/MarketingTracking.astro`.
- Load Pinterest and Reddit pixels during marketing tracking initialization
  without checking stored consent.
- Send Pinterest and Reddit `Lead` events on tracked Discord CTA clicks whenever
  their browser pixel functions are available.
- Update the Scout privacy policy to say Pinterest and Reddit pixels load by
  default for page visits and Add to Discord clicks.

## Verification

- Run frontend `typecheck`, `lint`, and `build` with placeholder Pinterest and
  Reddit pixel IDs.
- Confirm removed consent UI strings and state keys are gone from frontend
  source.
- Smoke-test the marketing page in the in-app browser to confirm no cookie
  popup appears and a Discord CTA click does not produce a browser error.
