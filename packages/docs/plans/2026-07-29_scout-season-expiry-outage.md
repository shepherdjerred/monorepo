---
id: plan-scout-season-expiry-outage-2026-07-29
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Fix Scout Production Season-Expiry Outage

## Summary

Restore production with the verified Scout `2.0.0-7074` release pair, then
prevent expired season metadata from crashing the backend. Season presets will
use Discord autocomplete with strict submitted-value validation, while
Prometheus alerts provide promotion runway. League Classic parsing defects are
excluded.

## Implementation

### Emergency recovery

- Revalidate that `2.0.0-7074` resolves to
  `sha256:f5e6add31cb08c1919c667dff6216318aca82d2918758f6bc742552a2ff3e024`,
  its release state descends from the season fix, and its beta, site archive,
  and tag jobs passed.
- Promote that exact release pair through a narrow GitOps pin PR.
- Require a green Buildkite run on the PR head and on the resulting `main`
  merge commit. A green predecessor is not evidence for the current head.

### Season resilience

- Replace static `/competition create` and `edit` season choices with
  autocomplete. An empty season corpus disables only the preset suggestions;
  it must not terminate HTTP, Discord, polling, or fixed-date competitions.
- Keep `SeasonIdSchema` validation on submission so stale or manually typed
  invalid IDs are rejected.
- Add a deterministic clock input to `getSeasonChoices`, a pure completion
  helper, and tests for active, future, ended, boundary, and empty schedules.
- Export the latest bundled season end timestamp as a Prometheus gauge. Warn
  from 14 days through 3 days remaining and page below 3 days, including after
  expiration, for production only.
- Reuse the existing weekly season-refresh automation rather than adding a
  duplicate updater.

### Hardened promotion

- Verify the resilience release in beta, including command registration,
  autocomplete, strict rejection, health, logs, and the new metric.
- Promote only the complete release pair minted by `scout-tag-release` through
  the normal Renovate production-promotion PR.
- Never hand-pair a tag and digest or mutate the live Deployment directly.

## Verification

- Focused build, test, typecheck, lint, backend container smoke, and staged-file
  hooks pass for the changed packages.
- Buildkite passes on every PR head and on each merge-generated `main` build.
- Argo CD is `Synced` and `Healthy`; the intended image is Ready, has stable
  restarts, and backs the Service endpoints.
- `/api/ping` and `/api/healthz` return 200, while `.release-version`, frontend
  identity, and backend version agree.
- Production logs show normal Discord and competition startup without the
  season-registration fatal error.

## Assumptions

- Recovery target is exactly
  `2.0.0-7074@sha256:f5e6add31cb08c1919c667dff6216318aca82d2918758f6bc742552a2ff3e024`.
- Production changes remain GitOps-managed and require normal review and merge
  authorization.
- League Classic queue, map, champion, and report compatibility are omitted.
- If `7074` no longer validates, mint a new complete release pair from current
  `main`; do not promote an unverifiable candidate.

## Remaining

- [ ] Publish and merge the recovery PR, then verify the exact-head Buildkite
      and production rollout.
- [ ] Implement and verify season autocomplete resilience.
- [ ] Add and verify season schedule runway telemetry and alerts.
- [ ] Promote the hardened release and complete production acceptance.

## Comment Log

- 2026-07-29: Restored the canonical top-level remaining-work inventory after
  Buildkite #7203 correctly rejected the active board plan for recording open
  tasks only inside its session log.

## Session Log — 2026-07-29

### Done

- Confirmed the implementation plan and recovery release candidate.
- Revalidated the `2.0.0-7074` OCI tag, backend digest, Buildkite release
  metadata, immutable archive verification jobs, and ancestry from the season
  fix.
- Updated the GitOps production pin to the exact verified release pair.
- Preserved the open recovery and resilience work in the canonical top-level
  board workflow section required by `check-docs`.

### Remaining

- [ ] Publish and merge the recovery PR, then verify the exact-head Buildkite
      and production rollout.
- [ ] Implement and verify season autocomplete resilience.
- [ ] Add and verify season schedule runway telemetry and alerts.
- [ ] Promote the hardened release and complete production acceptance.

### Caveats

- Production was still unavailable at the start of implementation.
- Current `main` Buildkite had a pipeline-upload `stack_error`; the recovery
  merge needs an exact-head green build.
