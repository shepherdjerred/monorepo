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

In PostHog project privacy settings, IP collection must stay **enabled** — it is
what produces the country and city breakdowns — and session-recording masking
stays at the standard setting. Leave _Cookieless server hash mode_ **disabled**.

All eight sites use PostHog's default persistence (a first-party cookie plus
`localStorage`), create person profiles, and capture autocapture, heatmaps, dead
clicks, web vitals, and session replay with inputs masked. Every site respects
Do Not Track, so a DNT browser sends nothing at all. See PostHog's
[JavaScript configuration](https://posthog.com/docs/libraries/js/config) and
[privacy controls](https://posthog.com/docs/privacy/data-collection).

Cookieless mode is deliberately not used, and the reason is worth remembering.
PostHog's ingestion **drops** events flagged cookieless unless the project has
cookieless server hash mode enabled, and the capture endpoint answers `200`
either way — so six of these sites recorded nothing at all for months while
every network-level check looked healthy. Cookieless mode also rules out session
replay, and its server-side hash rotates daily, which forecloses
returning-visitor and multi-day retention analysis.

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

Each event's distinct ID combines the deployment site key with the opaque
installation UUID, and every event also carries `guild_id`, the Discord guild
id. The two identifiers are not interchangeable: the installation UUID rotates
on reinstall so install-level funnels restart cleanly, while `guild_id` is
stable for a server's whole history. The web app registers the same `guild_id`
as a super property, which is what lets a browser session be joined to a guild
installation.

Person profiles and GeoIP are enabled, so installations support retention
analysis and a country breakdown. PostHog _group_ analytics is deliberately not
used: it is a paid add-on that reprices every identified event across all eight
sites, and the `guild_id` property answers the same questions through breakdowns
and filters.

The backend still never sends user or channel IDs, guild names, Riot IDs,
command inputs, message content, URLs, or error text. Deployed values come from
the shared registry through
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

Verify every item in PostHog **Live Events**, not in the browser network tab. A
`200` from the capture endpoint is not evidence that an event was stored — that
is precisely how the cookieless outage went unnoticed.

- Open every hostname with Do Not Track disabled and confirm a fresh pageview
  and autocapture event arrives in Live Events with the expected `site_key` and
  `site_hostname`.
- Reload a page and confirm the distinct ID is unchanged, then confirm a person
  profile exists for that anonymous visitor.
- Navigate through the Scout web app and confirm recorded URLs still template
  dynamic identifiers (`/g/:guildId`, `/players/:alias`).
- Confirm `$geoip_country_name` is populated on both browser and backend events.
- Confirm session recordings appear for all eight hosts with input masking
  active.
- Repeat with Do Not Track enabled and confirm the browser sends no PostHog
  events.
- Sign into Scout and confirm the pre-login anonymous person merges into the
  identified person, that `guild_id` is attached to events inside a guild
  workspace, and that signing out starts a new anonymous distinct ID.
- With controlled beta and production guilds, verify install, web and Discord
  first-subscription, core-output, removal, and reinstall events in Live Events,
  and that a reinstall rotates the installation UUID while `guild_id` holds.
- Validate the saved Scout lifecycle funnel, retention, output-trend, and
  removal-breakdown insights against the controlled guild sequence.

Repository and CI checks prove configuration and release wiring only. They do
not replace these live project and browser checks.
