---
id: log-2026-07-25-scout-prod-promotion-vs-renovate
type: log
status: complete
board: false
---

# Q&A: Why do we create "promote scout-for-lol to prod" PRs when Renovate exists?

Question: why does CI open PRs like `feat(homelab): promote scout-for-lol 2.0.0-6076 to prod` when prod bumps supposedly already happen via Renovate?

Answer: Renovate does not manage the scout prod pins — the promote PR is the promotion mechanism by design.

- Renovate only manages third-party deps (annotated entries in `packages/homelab/src/cdk8s/src/versions.ts`). The scout pins are marked `not managed by renovate` (lines ~153–166).
- Beta pin: auto-bumped by the CI version commit-back step.
- Prod pins: moved only by the standing `scout-promote-pending` PR opened/refreshed by the `scout promotion PR` Buildkite step (`.buildkite/pipeline.yml:1176`, `scripts/promote-scout.ts --ci`). Merging it is the prod deploy (human gate).
- Renovate can't do this because: (1) backend image + site artifact pins must move in lockstep to avoid tRPC skew; (2) `scout-for-lol-site/prod` is an archived static-site artifact with no Renovate datasource; (3) promotion is intentionally lagging/gated, not "newest available".

References: version-management skill, `packages/scout-for-lol/AGENTS.md` § Stage deploys.

Follow-up (user pushback): the user correctly remembered that Renovate used to bump the scout prod pin. Verified: before PR #1567 (merged 2026-07-19), `shepherdjerred/scout-for-lol/prod` carried a `// renovate:` annotation (`datasource=docker … packageName=shepherdjerred/scout-for-lol`) — the same pattern `shepherdjerred/starlight-karma-bot/prod` still uses. #1567 removed the annotation and introduced `promote-scout.ts` because Renovate bumping only the backend image (while prod served latest-main site content) shipped tRPC contract skew (the filters crash). Renovate's custom manager only matches annotated lines, so it can no longer touch the scout prod pins on main. Starlight keeps the Renovate pattern because it's a single deployable with no lockstep site artifact.

## Session Log — 2026-07-25

### Done

- Answered the question with verification against `versions.ts` and `.buildkite/pipeline.yml`; no code changes.

### Remaining

- None. (If a Renovate PR is ever observed touching the scout prod pins, that's a bug to investigate.)

### Caveats

- None.
