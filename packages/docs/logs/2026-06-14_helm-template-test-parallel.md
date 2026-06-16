# Helm Template Test — Parallelize + Bump Timeout

## Status

Complete

## Context

Main was red on build [#4412](https://buildkite.com/sjerred/monorepo/builds/4412) (and several preceding builds) on `:dagger_knife: pkg-check`. The failing test was `packages/homelab/src/cdk8s/src/helm-template.test.ts` → `"Helm Escaping - helm template (dist/) > should render all charts with helm template without errors"`, which timed out at `5000.37ms` — bun's default per-test timeout.

The test was rendering all 28 charts **serially** via synchronous `Bun.spawnSync(["helm", "template", ...])`. Under load on the CI agent (single-node torvalds, heavy concurrent jobs), 28 sequential helm subprocesses regularly blow past 5s.

Memory note `reference_homelab_precommit_helm_template_timeout` documented this as a known retry-able flake, but the recent main streak (multiple builds back) made it worth fixing at the root.

## Change

`packages/homelab/src/cdk8s/src/helm-template.test.ts`:

1. **`helmTemplateChart`** — switched from `Bun.spawnSync` to async `Bun.spawn` with piped stdout/stderr, awaited via `Promise.all([Response.text(), Response.text(), exited])`. Lets the runtime overlap helm subprocesses.
2. **`"should render all charts ..."`** — replaced the serial `for` loop with `Promise.all(chartNames.map(...))` so all 28 charts render concurrently. Kept the `HELM_TEMPLATE_TIMEOUT_MS = 60_000` constant that PR #1249 introduced as a safety net; updated the surrounding comment to reflect that the loop is now parallel.

Other tests in the same file (E2E content verification) already call `helmTemplateChart` independently and benefit automatically from the async spawn — no further changes needed there.

(Mid-session, PR #1249 landed on main and bumped the timeout to 60s without parallelizing. Rebased onto it; the resolved file keeps the parallel render and adopts the existing named constant.)

## Verification

`packages/homelab/src/cdk8s`:

- `bun test src/helm-template.test.ts` — `10 pass / 0 fail`, `1136ms` wall time (was timing out at 5000ms). `time` reports `320% CPU` confirming concurrent execution.
- `bun run typecheck` — clean.
- `bunx eslint src/helm-template.test.ts` — clean.

## Session Log — 2026-06-14

### Done

- Edited `packages/homelab/src/cdk8s/src/helm-template.test.ts` to (a) run helm subprocesses async via `Bun.spawn` and (b) parallelize the all-charts render loop with `Promise.all` + a 120s timeout safety net.
- Verified locally: test went from a 5000ms timeout failure to `1136ms` pass (320% CPU).
- Typecheck + eslint clean.

### Remaining

- None — landed as a one-shot fix.

### Caveats

- 28 parallel helm subprocesses spike instantaneous CPU; on torvalds (single node) this is still well under saturation, but if it ever causes new flakes we can introduce a concurrency cap.
- The E2E content-verification tests still call `helmTemplateChart("apps")` multiple times redundantly — wasteful but out of scope for this fix.
