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
- GeoIP enabled: project-level IP collection on, and the backend's three
  GeoIP suppressions removed.
- Session replay, heatmaps, dead clicks, and web vitals on every site.
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
  to `{ capture, identify, reset, register, unregister }`; `identifyUser` in
  `require-session.tsx`, `resetIdentity` in `user-menu.tsx`, and the `guild_id`
  super property in `guild-workspace.tsx`.
- Scout backend: GeoIP on, `$process_person_profile: false` removed, `guild_id`
  added to all five lifecycle events via `AnalyticsInstallation.serverId`.
- `scripts/check-analytics-sites.ts` rewritten to assert the new posture, plus
  a forbidden-key check: `cookieless_mode`, `persistence:`, and `before_send`
  must be **absent**, because each degrades collection silently rather than
  failing loudly.

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
