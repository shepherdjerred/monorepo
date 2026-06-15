# Unbreak main CI — build #4369

## Status

In Progress

## Context

Buildkite main build [#4369](https://buildkite.com/sjerred/monorepo/builds/4369)
(commit `11a87464e`) failed `:dagger_knife: pkg-check` (streambot) and
`:scissors: Knip` — but **still pushed 12 image digests and `helm-pushed-all=1`**.
Knip is `softFail: true` so it's informational; the actual blocking failure is
the streambot metrics test timing out at 5 s. The deeper problem is the release
gate: `quality-gate` only depends on `quality-bundle` + a few conditional repo-
wide gates, **not** on per-package `pkg-check-*`. So a failing pkg-check only
blocks that one package's image build — every other image and the helm chart
ship under a red main.

## What the PR changes

1. **`scripts/ci/src/pipeline-builder.ts`** — push every per-package group key
   into `releaseDeps`. Now `quality-gate` (and therefore every image-build,
   image-push, helm-push-all, cdk8s-bundle, npm-publish, site-deploy,
   tofu-apply, argocd-sync, version-commit-back) blocks on every package's
   pkg-check. Release-train rule: main red ⇒ nothing ships.
2. **`scripts/ci/src/steps/quality.ts`** — delete 17 orphaned `*Step()` helpers
   (`prettierStep`, `markdownlintStep`, `shellcheckStep`, `qualityRatchetStep`,
   `complianceCheckStep`, `gitleaksCheckStep`, `suppressionCheckStep`,
   `daggerHygieneStep`, `reactVersionSyncStep`, `lockfileCheckStep`,
   `envVarNamesStep`, `lineEndingsCheckStep`, `scoutTestTemplateCheckStep`,
   `migrationGuardStep`, `checkTodosStep`, `mergeConflictStep`,
   `largeFileStep`). PR #1234 inlined every check into `qualityBundle` /
   `softFailBundle` Dagger funcs and left the BK helpers behind. The
   underlying checks still run via `qualityBundleHelper`
   (`.dagger/src/quality.ts:543`). Knip stays `softFail: true`.
3. **`packages/streambot/test/metrics.test.ts`** — raise the failing test's
   timeout to 30 s (Bun `test(name, fn, timeoutMs)`). The test does a real
   `Bun.serve` bind + three localhost fetches, each running
   `register.metrics()` → `collectDefaultMetrics`; 5 s flakes under buildAll
   contention.
4. **`scripts/ci/src/__tests__/pipeline-builder.test.ts`** — flip the
   "quality-gate depends only on quality checks, not per-package builds"
   assertion to the new release-train contract (asserts every `pkg-*` key is
   in `depends_on`, soft-fail keys still excluded). Also fix a pre-existing
   wrong assertion that expected the Dagger CLI to expose
   `homelab-cdk8s-bundle` rather than the kebab-case-with-digit-boundary
   `homelab-cdk-8-s-bundle`.

## Critical files

- `scripts/ci/src/pipeline-builder.ts:152-167` — releaseDeps now includes every per-package group key.
- `scripts/ci/src/steps/quality.ts` — 17 helpers deleted; 10 still exported (qualityBundle, knipCheck, trivyScan, softFailBundle, tunnelDnsCoverage, talosSchematicSync, semgrepScan, bunLockDriftCheck, greptileReview, caddyfileValidate).
- `packages/streambot/test/metrics.test.ts:29-50` — third arg `30_000` on the failing test.
- `scripts/ci/src/__tests__/pipeline-builder.test.ts:599-643` — flipped contract test.

## Verification (in worktree)

- `bun run knip` (worktree root): **exit 0, 0 unused exports**.
- `cd packages/streambot && bun test test/metrics.test.ts` × 5 consecutive runs: all `3 pass / 0 fail`.
- `cd packages/streambot && bun run typecheck`: clean.
- `cd scripts/ci && bun test src/__tests__/pipeline-builder.test.ts`: 74 pass / 0 fail (was 73/1 on main — pre-existing cdk8s-bundle assertion bug fixed here).
- `cd scripts/ci && bun run typecheck`: clean.

## Memory follow-up

Save once merged:

1. `reference_release_gate_includes_pkg_check.md` — "Release gate must include every per-package `pkg-check-*` key in `releaseDeps`; per-package gating on image build alone leaks cross-package failures to ghcr/helm. Soft-fail checks (knip/trivy/semgrep/softFailBundle/tunnelDnsCoverage/talosSchematicSync) correctly stay out. See PR #XXXX, build #4369."
2. Reinforce `feedback_soft_failures_ci.md` — "Knip is `softFail: true` (quality.ts:118). Job state "failed" in BK is informational only and does not gate release."
