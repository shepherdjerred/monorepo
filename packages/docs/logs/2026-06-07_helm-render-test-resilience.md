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
   pattern). Real errors — `404`/missing version, template errors,
   schema-validation failures — do **not** match the transient pattern and
   remain hard failures.
3. **Single render pass, one skip log** (follow-up commit, addresses a Greptile
   P1). The suite now renders every chart exactly once in `beforeAll` and logs
   transient skips there, in one place. Both assertions (`render` and
   `non-empty output`) read that shared result set instead of independently
   re-fetching every chart. This (a) fixes the "never silent" invariant — the
   old second test silently swallowed non-zero exits — and (b) halves the
   network load / flake surface, since charts were previously fetched twice.
   Also `.gitignore`d `.argocd-test-*` temp dirs (matching the existing
   `.helm-test-*` / `.helm-render-*` patterns) so a killed run can't leave
   staged junk.

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
  transient skip + classifier guardrail test). Commit `0ec2f34ff`.
- Follow-up `ed86e2da9`: render charts once in `beforeAll`, log skips in one
  place, both assertions read shared results (resolves Greptile P1 about silent
  skips in the second test; halves network/flake surface). `.gitignore`d
  `.argocd-test-*` temp dirs.
- Opened [PR #1081](https://github.com/shepherdjerred/monorepo/pull/1081);
  Buildkite build 3567 fully green (39/39 checks, incl. Test, Greptile, Line
  Endings). MERGEABLE.
- Verified typecheck, lint, and both test modes (network-free + live) locally.

### Remaining

- Merge PR #1081 (green + mergeable). Once on `main`, all PRs benefit. PR #1077
  (pinchtab) was separately driven green and is now **merged**.

### Caveats

- If a chart's repoURL is _permanently_ wrong in a way that only ever yields a
  5xx/`connection refused` (not `404`), it would now be skipped rather than
  failed. This is judged acceptable: such misconfig is rare, usually surfaces as
  `404`/DNS (still hard-fail), and is caught at deploy time by ArgoCD. The skip is
  logged loudly, never silent.
