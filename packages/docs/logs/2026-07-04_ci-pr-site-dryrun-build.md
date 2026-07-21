---
id: log-2026-07-04-ci-pr-site-dryrun-build
type: log
status: complete
board: false
---

# Catch site build regressions on PRs (dryrun site builds)

## Context

Follow-up to the scout-for-lol OG `jsxDEV` incident (main build 5069, fixed in a
separate PR). That deploy break reached `main` because the frontend `astro build`
— the only thing that generates OG images — runs **only** in the site-deploy
step, which never executed on the pull request.

## Root cause (why PR CI didn't catch it)

`scripts/ci/src/pipeline-builder.ts` gates the site-deploy group on
`releaseBuild`:

```ts
const releaseBuild = !pullRequestBuild; // pullRequestBuild = BUILDKITE_PULL_REQUEST != "false"
...
if (releaseBuild && (affected.buildAll || affected.hasSitePackages.size > 0)) {
  steps.push(deploySitesGroup(...));
}
```

So on a **genuine PR build** (`BUILDKITE_PULL_REQUEST` set), `releaseBuild` is
false and the site-deploy group — including the `astro build` — is never emitted.
The `--dryrun` machinery in `steps/sites.ts` (build, skip SeaweedFS sync) existed
and the module comment claimed "deploy steps run on every branch (PRs included),"
but the `releaseBuild` gate defeated it. It only ever fired on non-PR branch
builds (`BUILDKITE_PULL_REQUEST == "false"`), e.g. a manual re-run — which is why
PR #1382's build 4990 (a superseded, canceled non-PR build) briefly ran the scout
deploy, while the final merged PR build (5055) emitted **zero** site-deploy jobs.

Evidence from #1382's branch builds:

| build | commit    | site-deploys | note                     |
| ----- | --------- | ------------ | ------------------------ |
| 4990  | 6b264fe0f | 9            | non-PR re-run, canceled  |
| 5011  | 43124d9e9 | 0            | PR build                 |
| 5055  | 32878d596 | 0            | PR build that **merged** |

## Fix

`scripts/ci/src/pipeline-builder.ts`:

- Emit the site-deploy group on PR builds too, scoped to sites whose **source
  changed** (`hasSitePackages`) and **skipping `buildAll`** (infra/lockfile PRs)
  so they don't dryrun all ~9 sites. `deploySiteStep` already appends `--dryrun`
  via `DRYRUN_FLAG` on non-main branches, so the PR build runs but never syncs.
- PR dryruns don't sync, so their `siteDeployDeps` is empty (no `tofu-apply-all`
  wait, which is main-only).
- Fold the emitted deploy step keys into `ci-complete`'s `depends_on`, so a failed
  dryrun fails the required GitHub check and **blocks the merge**. (Previously
  nothing depended on the deploy steps; a skipped step is a vacuously-green
  required check — which is also why "a canceled build's failure should have
  blocked merge" didn't help: there was no emitted step to require.)

`scripts/ci/src/steps/sites.ts`: corrected the module comment to describe the
now-accurate behavior.

## Verification

- `scripts/ci` typecheck clean; `bun test` 307 pass (incl. 2 new pipeline-builder
  cases: scoped-site PR emits dryrun deploy + gates ci-complete; buildAll PR does
  not).
- End-to-end: generated the pipeline with a PR feature-branch env + a scoped scout
  change → `deploy-sites` present, scout deploy command carries `--dryrun`, depends
  only on `quality-gate` + `pkg-scout-for-lol` (not `tofu-apply-all`), and
  `ci-complete` depends on both scout prod + beta deploys.

## Session Log — 2026-07-04

### Done

- `scripts/ci/src/pipeline-builder.ts`: emit dryrun site builds on PRs for changed
  sites; gate `ci-complete` on them.
- `scripts/ci/src/steps/sites.ts`: comment corrected.
- `scripts/ci/src/__tests__/pipeline-builder.test.ts`: 2 new cases.

### Remaining

- None for this change. Residual (accepted) gap: `buildAll` (infra/lockfile) PRs
  still don't dryrun-build sites — they'd rebuild all ~9; those regressions are
  caught on main. Revisit only if an infra change breaks a site build in practice.

### Caveats

- PR dryrun deploys still pass `--target seaweedfs` + `env:SEAWEEDFS_*`, but
  `--dryrun` skips the sync, so no publish occurs and missing AWS creds are
  tolerated (Dagger defers the secret until use). Confirmed by build 4990's dryrun,
  which ran the astro build without valid AWS creds.

## Session Log — 2026-07-05

### Done

- `scripts/ci/src/pipeline-builder.ts`: renamed the stale "Main-only" block and
  `hasMainSteps` helper to describe the shared release / PR dryrun path.
- `scripts/ci/src/catalog.ts`: raised per-package Dagger wrapper resource tiers
  so the Buildkite agent and Dagger client have more memory headroom after build
  5090's `exit status -7` package-check failures.

### Remaining

- Wait for Buildkite on the pushed fix commit and address any new hard failures.

### Caveats

- Build 5090 was canceled after two package-check pods stopped without a normal
  exit; the logs pointed at likely pod OOM rather than a TypeScript/lint/test
  assertion.
- `bunx eslint . --fix` is not currently runnable for `scripts/ci` from either
  the package or repo root because no ESLint flat config is discoverable there.
