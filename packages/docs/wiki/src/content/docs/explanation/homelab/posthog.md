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

## Scout guild lifecycle

Scout's backend measures product activation without attaching Discord identity
to PostHog. Each guild installation gets a random UUID that changes only after
a confirmed removal and reinstall. Reconnect events preserve it. The lifecycle
state lives with the existing install record in
[`schema.prisma`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/prisma/schema.prisma).

The server records five milestones: install, first subscription, recurring core
output, first core output, and removal. Core output includes match notices,
reports, competition lifecycle messages, scheduled leaderboards, and the weekly
pairing report. Successful multi-channel sends count once per guild. Multi-part
messages count only after every part succeeds. The authoritative delivery paths
remain in the
[`league/tasks`](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol/packages/backend/src/league/tasks)
and
[`reports`](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol/packages/backend/src/reports)
modules.

The backend never sends guild, user, or channel IDs; guild names; Riot IDs;
command inputs; message content; URLs; or error text. Its distinct ID combines
the deployment site key with only the opaque installation UUID. Every event
disables person profiles and GeoIP. Browser visitors and guild installations
cannot be joined at person level. Deployed values come from the shared registry
through
[`scout/index.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/scout/index.ts).

This boundary deliberately excludes slash-command analytics, desktop, evals,
previews, setup messages, DMs, recovery notices, debug output, and failed
deliveries. Prometheus continues to answer operational questions. PostHog
answers whether an anonymous installation reaches and keeps receiving product
value.

## Source verification

Run `bun scripts/check-analytics-sites.ts`, then build each affected site. The
generated browser assets must contain the configured US hosts and must not
contain a retired analytics endpoint. Scout tests additionally cover route
normalization, bounded typed events, replay gating, local no-op behavior, and
beacon transport for outbound navigation.

Backend tests additionally cover deployed configuration, anonymous properties,
opaque lifecycle identity, reconnect and reinstall behavior, first-value
claims, successful-delivery boundaries, and removal classification.

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
- With controlled beta and production guilds, verify install, web and Discord
  first-subscription, core-output, removal, and reinstall events in Live Events.
- Inspect raw server event properties for prohibited identifiers and confirm
  that the events create no person profiles.
- Validate the saved Scout lifecycle funnel, retention, output-trend, and
  removal-breakdown insights against the controlled guild sequence.

Repository and CI checks prove configuration and release wiring only. They do
not replace these live project and browser checks.
