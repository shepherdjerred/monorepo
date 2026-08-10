---
title: PostHog Cloud analytics
description: Privacy configuration, public-token setup, and production verification.
---

PostHog Cloud US provides analytics for `sjer.red`, `resume.sjer.red`,
`webring.sjer.red`, `better-skill-capped.com`, `mariokart.sjer.red`,
`pokebot.sjer.red`, `scout-for-lol.com`, and `beta.scout-for-lol.com`. It is a
managed external service: the cluster has no PostHog namespace, database,
volume, DNS record, secret, or readiness dependency.

## Project setup

Use the existing single US project. Copy its public `phc_` project token into
`config/analytics-sites.json`; this token is safe to embed in browser bundles.
Never commit a `phx_` personal API key. The registry check deliberately fails
while the placeholder token is present.

In PostHog project privacy settings, disable IP collection and retain the
standard session-recording masking. The browser configuration owns the other
controls: it does not identify visitors, creates no person profiles, and
respects Do Not Track.

The six static sites initialize PostHog in always-cookieless mode and disable
session replay. Scout uses anonymous in-memory persistence because PostHog does
not support session replay with `cookieless_mode: "always"`; it still writes no
cookie or durable identifier. Every site respects Do Not Track. See PostHog's
[JavaScript configuration](https://posthog.com/docs/libraries/js/config) and
[privacy controls](https://posthog.com/docs/privacy/data-collection).

## Source verification

Run `bun scripts/check-analytics-sites.ts`, then build each affected site. The
generated browser assets must contain the configured US hosts and must not
contain a retired analytics endpoint. Scout tests additionally cover route
normalization, bounded typed events, replay gating, local no-op behavior, and
beacon transport for outbound navigation.

## Production acceptance

- Open every hostname with Do Not Track disabled and confirm a fresh pageview
  and autocapture event in PostHog Live Events with the expected `site_key` and
  `site_hostname`.
- Navigate through both Scout hosts and confirm recorded URLs omit query
  strings, fragments, and dynamic identifiers.
- Confirm session recordings appear only for the two Scout hosts and that
  standard masking is active.
- Repeat with Do Not Track enabled and confirm the browser sends no PostHog
  events.
- Inspect browser network traffic on all eight hosts and confirm there are no
  requests to either retired analytics service.

Repository and CI checks prove configuration and release wiring only. They do
not replace these live project and browser checks.
