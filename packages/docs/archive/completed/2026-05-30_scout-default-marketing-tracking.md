# Scout Default Marketing Tracking

## Status

Complete

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

## Session Log — 2026-05-30

### Done

- Removed consent storage, the consent banner, the Cookie settings button, and
  consent checks from
  `packages/scout-for-lol/packages/frontend/src/components/MarketingTracking.astro`.
- Enabled Pinterest and Reddit pixel loading by default and kept existing
  page-view, Plausible, internal `scout:conversion`, and Discord CTA `Lead`
  tracking behavior.
- Updated
  `packages/scout-for-lol/packages/frontend/src/pages/privacy.mdx` with the
  May 30, 2026 date and default-on Pinterest/Reddit pixel language.
- Verified frontend `typecheck`, `lint`, `build`, and the removed consent-string
  static check with placeholder pixel IDs.
- Smoke-tested the built marketing page in the in-app browser: no consent popup
  or settings button appeared, the tracking loader was present, and the home
  hero Discord CTA click produced no local Scout-page console errors.

### Remaining

- None.

### Caveats

- The fresh checkout needed `bun install --frozen-lockfile` and Prisma client
  generation before frontend typecheck could run.
- Astro preview needed sandbox escalation to bind a local port for browser
  verification.

## Session Log — 2026-05-30 (Greptile Follow-up)

### Done

- Moved the completed plan from `packages/docs/plans/` to
  `packages/docs/archive/completed/`.
- Updated `packages/scout-for-lol/packages/frontend/src/pages/privacy.mdx` to
  state that Scout does not provide an in-page marketing cookie settings control
  and to document browser, platform, and Discord server paths for limiting or
  requesting restriction of marketing measurement data.
- Re-ran frontend `typecheck`, `lint`, `build`, and the removed consent-string
  static check with placeholder pixel IDs.

### Remaining

- None.

### Caveats

- Frontend build still emits non-fatal Vite chunking warnings for existing
  large/circular chunks.
