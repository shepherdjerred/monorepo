# Helm-render test resilience (flaky external-chart fetches)

## Status

Complete

## Context

While getting [PR #1077](https://github.com/shepherdjerred/monorepo/pull/1077) CI
green, the `:test_tube: Test` step flaked on two consecutive Buildkite builds
(3543, 3545) in the same place:

```
ArgoCD Helm Render - External Charts > should render all external helm charts with our values
  Error: failed to fetch https://github.com/.../prometheus-adapter-5.3.0.tgz : 504 Gateway Time-out
  Error: failed to fetch https://github.com/itzg/.../mc-router-1.5.0.tgz : 504 Gateway Time-out
```

`packages/homelab/src/cdk8s/src/argocd-helm-render.test.ts` renders every
external Helm chart referenced by our ArgoCD `Application` CRDs by fetching the
pinned chart live from its upstream repo (GitHub release tarballs, etc.) and
running `helm template`. GitHub's release CDN intermittently serves `504`s for a
few seconds; the test already retried transient errors but only over a ~10s
budget (delays `1s + 3s + 6s`, 4 attempts), which was too short to ride out the
blip — so the whole build went red on an upstream hiccup unrelated to the change.

## Fix

Two changes to `argocd-helm-render.test.ts`, no behavior change for real failures:

1. **Longer, jittered backoff.** `HELM_RETRY_DELAYS_MS` extended to
   `[1s, 2s, 4s, 8s, 16s, 30s]` (7 attempts, ~60s base). Added ±25% `jitter()`
   so a fleet of charts hitting the same flaky upstream don't retry in lockstep.
   Per-test timeout raised `300s → 600s` for full-fleet headroom.
2. **Transient-after-retries → non-fatal skip.** `helmTemplate` now returns a
   `transient` flag (final result still matched the strict upstream/5xx/network
   pattern). The render test routes those to a loudly-logged `transientSkips`
   bucket instead of failing the build. Real errors — `404`/missing version,
   template errors, schema-validation failures — do **not** match the transient
   pattern and remain hard failures.

The test's contract is "do OUR values render against the pinned chart" — which
can only be asserted once the chart is actually fetched. Upstream CDN
availability is not our config and shouldn't gate the PR.

### Guardrail test

Added a network-free `describe("transient helm error classification")` block
(always runs, incl. pre-commit) that pins both directions of the classifier:
7 representative upstream/network stderrs must classify transient; 5
representative real chart/values stderrs must classify hard. Plus a jitter-bounds
test. This is what keeps the skip behavior from ever drifting into hiding real
failures.

## Verification

- `bun test src/argocd-helm-render.test.ts` (network-free): 13 pass, 0 fail (network suite skipped).
- `HELM_RENDER_TEST=1 bun test ...` (full, live network): 3 pass, all 31 charts rendered, 159s.
- `bunx tsc --noEmit` (cdk8s): clean.
- `bunx eslint src/cdk8s/src/argocd-helm-render.test.ts`: clean.

## Session Log — 2026-06-07

### Done

- Hardened `packages/homelab/src/cdk8s/src/argocd-helm-render.test.ts` against
  transient upstream chart-fetch failures (longer jittered retries + non-fatal
  transient skip + classifier guardrail test).
- Verified typecheck, lint, and both test modes (network-free + live) locally.

### Remaining

- None. (Standalone PR off `main`; once merged, all PRs benefit — including #1077,
  which was separately retried to green.)

### Caveats

- If a chart's repoURL is _permanently_ wrong in a way that only ever yields a
  5xx/`connection refused` (not `404`), it would now be skipped rather than
  failed. This is judged acceptable: such misconfig is rare, usually surfaces as
  `404`/DNS (still hard-fail), and is caught at deploy time by ArgoCD. The skip is
  logged loudly, never silent.
