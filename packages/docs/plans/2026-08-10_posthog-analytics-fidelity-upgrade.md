---
id: plan-2026-08-10-posthog-analytics-fidelity-upgrade
type: plan
status: in-progress
board: true
verification: operator
disposition: blocked
---

# PostHog analytics fidelity upgrade

## Why

Only Scout reported data in PostHog. The six static sites initialized with
`cookieless_mode: "always"`, and PostHog's ingestion drops cookieless-flagged
events unless the project enables _Cookieless server hash mode_, which defaults
to `Disabled`. The capture endpoint answers `200` regardless, so the 2026-08-09
cutover's acceptance evidence ("successful ingestion responses from all eight
hostnames") could not distinguish an accepted event from a dropped one.

Scout's own data was distorted separately: `persistence: "memory"` reset the
distinct ID and session ID on every full page load, so unique visitors were
closer to page loads, the Discord OAuth redirect always returned as a new
anonymous person, and cross-visit retention was impossible.

This plan deliberately reverses the privacy posture recorded in that cutover, in
favour of analytical fidelity.

## Decisions

- Durable persistence (first-party cookie + `localStorage`). **`respect_dnt`
  stays `true`** — DNT browsers still send nothing.
- `person_profiles: "always"` on all eight sites; `identify()` on Discord login
  and `reset()` on sign out in the Scout web app.
- Guild attribution via a plain `guild_id` property on both the backend events
  and the browser super properties. PostHog **group** analytics is rejected: it
  is a paid add-on whose billing applies to every identified event across all
  eight sites sharing this project. No speculative `groups` plumbing was added.
  The browser property is session-scoped and registered only after the server
  validates guild access; see the review-follow-up notes below.
- GeoIP enabled for browser events via project-level IP collection, and left
  **disabled** on the backend: those captures carry no end-user `$ip`, so the
  only location PostHog could resolve is the backend's own egress.
- Session replay, heatmaps, dead clicks, and web vitals on every site. Sites
  that render a signed-in Discord identity as text mask every text node, since
  `maskAllInputs` covers form values only.
- Ad-blocker resilience via PostHog's **managed** reverse proxy (free on Cloud,
  Cloudflare-backed), one proxy hostname per registrable domain.

## Phase 1 — shipped

Restores ingestion on the six dead sites and raises fidelity everywhere.
`api_host` intentionally still points at `https://us.i.posthog.com`.

- Registry `sessionReplay: true` for all eight sites.
- All seven browser trackers: dropped `cookieless_mode`, `persistence`, and the
  `before_send` hook that rewrote `$current_url` to `origin + pathname` and
  discarded campaign query strings. Added heatmaps, dead clicks, web vitals,
  replay, `person_profiles: "always"`, `capture_pageview: "history_change"`.
- Scout web app: widened the injected client seam from a bare capture function
  to one carrying `capture`, `identify`, `reset`, `isIdentified`, `register`,
  `registerForSession`, and `unregisterForSession`; `identifyUser` in
  `require-session.tsx`, `resetIdentity` in `user-menu.tsx`, and the `guild_id`
  super property in `guild-workspace.tsx`.
- Scout backend: `$process_person_profile: false` removed, `guild_id` added to
  all five lifecycle events via `AnalyticsInstallation.serverId`.
- `scripts/check-analytics-sites.ts` rewritten to assert the new posture, plus
  a forbidden-key check: `cookieless_mode`, `persistence`, and `before_send`
  must be **absent**, because each degrades collection silently rather than
  failing loudly. Matched by regex on the key plus `:` or `(` rather than a
  fixed substring, so `persistence : "memory"` cannot slip through.

### Review follow-ups — shipped

Durable persistence made four latent identity issues load-bearing, so each was
fixed rather than deferred:

- `require-session.tsx` resets identity whenever the session resolves anonymous,
  not only on the sign-out menu path: an expired or revoked cookie runs no
  handler, and the login page would otherwise stay attributed to the previous
  Discord user. `resetIdentity` is guarded by `posthog._isIdentified()` so an
  ordinary anonymous visitor keeps their distinct id.
- `guild_id` is registered with `register_for_session`, and only once
  `usePermissions` confirms access. A durable property outlived the visit; an
  eagerly registered route param let any signed-in visitor deep-link
  `/g/<anything>` and stamp an arbitrary, unbounded value onto every event.
- Mario Kart, Pokémon, and the Scout web app set `maskTextSelector: "*"`.
  `maskAllInputs` masks form values, so replay was recording usernames, guild
  names, Riot accounts, and player aliases as ordinary text — and with
  `person_profiles: "always"` each recording is tied to an identified person.
- Backend `disableGeoip: true`, because those events carry no end-user `$ip`.
- The browser identifies with `User.analyticsUserId`, a new opaque app-owned
  UUID, instead of the Discord snowflake. The distinct id is the durable join
  key for a person's events and recordings, and the registry rule against
  sending Discord user ids applies to it. Migration
  `20260811210000_user_analytics_identity` rebuilds `User` to add the column
  (SQLite cannot add a NOT NULL UNIQUE column with a non-constant default) and
  backfills existing rows with the same `randomblob` UUIDv4 expression already
  used for `GuildInstall.analyticsInstallationId`. Existing signed-in people
  therefore get a new PostHog identity once on deploy; their pre-migration
  events stay under the old distinct id and do not merge.

## Phase 2 — blocked on operator steps

Split from phase 1 deliberately. `posthog-bootstrap.js` and the web app's env
schema hard-gate on `apiHost === "https://us.i.posthog.com"` and silently
disable analytics on mismatch, so the host must not move before the proxy is
verified live.

Operator prerequisites, in order:

1. Create three managed proxies at `app.posthog.com/settings/organization-proxy`
   for `edge.sjer.red`, `edge.better-skill-capped.com`, and
   `edge.scout-for-lol.com`; record each generated `*.proxy-us.posthog.com`
   target.
2. Project settings: enable IP collection; leave cookieless server hash mode
   disabled; confirm replay is on with 100% sampling.

Then:

- Split the registry's single `apiHost` into a per-site browser `ingestHost` and
  a top-level `serverApiHost`. The backend uses posthog-node and must keep
  talking to PostHog directly. `assetHost` disappears: the loader derives the
  asset URL from `api_host` by string surgery, and the managed proxy serves
  `/static/*` and `/array/*`.
- Update all four duplicate copies of the registry schema:
  `config/analytics-sites.schema.json`, `scripts/check-analytics-sites.ts`,
  `scripts/scout-site-release.ts`, and
  `packages/homelab/src/cdk8s/src/resources/scout/analytics.ts`.
- Add one CNAME per zone in `packages/homelab/src/tofu/cloudflare/` with
  **`proxied = false`** — the only gray-cloud record in the repo, because
  Cloudflare's orange-cloud proxy breaks PostHog's certificate provisioning.
  Existing CAA records already allow `letsencrypt.org` and `pki.goog`.
- Add the proxy host to `scoutCsp` in `s3-static-sites/sites.ts`; `sites.test.ts`
  asserts full-directive substrings and will need updating.

## Remaining

- [ ] Operator: create the three managed proxies and record their targets.
- [ ] Operator: enable IP collection in PostHog project settings.
- [ ] Split the registry into per-site `ingestHost` plus a top-level
      `serverApiHost`, and update all four schema copies.
- [ ] Add the three gray-cloud CNAMEs in `packages/homelab/src/tofu/cloudflare/`.
- [ ] Add the proxy host to `scoutCsp` and update `sites.test.ts`.
- [ ] Run the live acceptance checklist and record the result here.

## Verification

Repository checks prove wiring only. Live acceptance is the checklist in
[the PostHog wiki page](/explanation/homelab/posthog/), which now requires
confirming events in **Live Events** rather than reading a `200` off the network
tab — the exact check that missed this outage.

## Risks

- Cost: person-profile events price above anonymous ones, and replay moved from
  two hosts to eight. Check billing after a week of real traffic.
- Consent: analytics cookies for EU visitors would conventionally want a banner.
  DNT is still respected, which is not equivalent. Accepted explicitly.
- DNS uncloaking: NextDNS/Pi-hole users who follow the CNAME chain still block
  the proxy; browser extensions cannot.
