---
id: 2026-07-24-ci-main-scout-promotion-archive-mismatch
type: log
status: in-progress
board: false
---

# CI on main red — scout promotion asserts an archive the build never created

## Goal

Get CI on `main` green without sacrificing quality. Recent main builds
[#6022](https://buildkite.com/sjerred/monorepo/builds/6022) (`ee555eace`, "chore:
bump pending image versions") and [#6024](https://buildkite.com/sjerred/monorepo/builds/6024)
(`e6201adbf`) both `failed` on the same job: **`:package: scout promotion PR`**
(exit 1); `:package: release-please` was then canceled downstream.

## Diagnosis

The `scout promotion PR` step runs
`scripts/promote-scout.ts --ci --site-version 2.0.0-$BUILDKITE_BUILD_NUMBER`.
It failed with:

```
promotion warranted: prod has never been promoted
error: no archive manifest for 2.0.0-6024 in s3://scout-site-releases/ —
the version was never (completely) archived or has expired.
```

**Root cause — a lane-gating mismatch between "promote" and "archive".**

- The scout **site archive** (`scout-site-release.ts archive --version 2.0.0-<build>`,
  which writes the `<version>.json` manifest that `assertArchived` checks) runs
  inside the `:rocket: deploy sites` step, gated by the **`sites`** lane in
  `.buildkite/scripts/ci-changed.sh`. The `sites` lane_paths do **NOT** include
  `packages/homelab/src/cdk8s/src/versions.ts`.
- The **`scout-promotion`** lane (and the `site-scout` sub-lane) **DO** watch
  `versions.ts`.

So a main build whose only relevant change is `versions.ts` — e.g. the frequent
`chore: bump pending image versions` commits, which bump the
`shepherdjerred/scout-for-lol/beta` pin — **skips the `sites` step entirely**
(archive never runs) yet **still runs `scout-promotion`**, which then demands
`s3://scout-site-releases/2.0.0-<this build>.json`. That manifest doesn't exist,
so it fails.

The `sites` job log for #6024 confirms it: `sites: unchanged since a8fc5d566…;
skipping`.

Why promotion was "warranted" every time: `promote-scout.ts` uses
`2.0.0-$BUILDKITE_BUILD_NUMBER` (the _current build_) as the target site version,
on the assumption that _this build archived the site_. That assumption only holds
when the `sites`/`site-scout` step actually ran the archive in the same build.
When it didn't, the target version was never archived.

At the time of #6022/#6024 the prod site pin was still the `unpromoted` sentinel,
so `promotionReason` returned "prod has never been promoted" on every build. That
sentinel path was later resolved by PR #1603 (merge `d51e2a103`, build #6042),
which promoted `scout-for-lol-site/prod` → `2.0.0-6017`. **But the bug is latent,
not fixed:** `shepherdjerred/scout-for-lol/beta` (`2.0.0-6017@…`) ≠
`shepherdjerred/scout-for-lol/prod` (`2.0.0-5991@…`), so `promotionReason` now
returns "backend image changed" instead — still warranted. The next
`versions.ts`-only bump (no `sites`-lane path touched) will fail #6024's failure
all over again.

Build #6042 (`d51e2a103`) will likely pass this step only incidentally: it
changed `.buildkite/pipeline.yml` (a `global_paths` entry), which triggers the
`sites` lane → the archive runs → `2.0.0-6042` exists.

## Fix (durable)

The target site version must be **the version beta actually serves**, not the
current build number. Beta only ever serves a fully-archived version (the
`sites` step archives, then `deploy-beta` writes the `.release-version` marker
last), so promoting the beta-marker version is always safe — `assertArchived`
can never fail on it.

- CI mode resolves the target from the beta bucket marker
  (`s3://scout-frontend-beta/.release-version`) via S3 (CI already has SeaweedFS
  creds), instead of using `--site-version 2.0.0-<build>`.
- When this build _did_ archive a new site, `deploy-beta` already advanced the
  marker to `2.0.0-<build>` before `scout-promotion` runs (`depends_on: sites`),
  so behavior is unchanged in that case.
- When the build didn't archive, we promote the site version beta is serving
  paired with the current committed beta image pin — which is exactly "what beta
  runs".
- If the beta marker is missing/unparseable (beta never deployed), there is
  nothing to promote → log and exit 0 rather than failing main.

Drop `--site-version` from the CI invocations in `.buildkite/pipeline.yml`.

## Implementation

Branch `fix/scout-promote-beta-marker` (worktree `.claude/worktrees/scout-promote-beta-marker`).

- `scripts/promote-scout.ts`
  - New `betaServedVersion()` reads the beta bucket's `.release-version` marker
    (`s3://scout-frontend-beta/.release-version`) via a new shared
    `s3CpToStdout()` helper (also dedups the `manifestGitSha` S3 read).
  - `ciPromote()` no longer takes a `--site-version`; it resolves the target
    from `betaServedVersion()`. Null marker → log + exit 0 (nothing to promote).
  - Operator mode's default target now reuses `betaServedVersion()` (S3) instead
    of the old HTTPS `betaMarkerVersion()` fetch — deleted, along with the
    `BETA_MARKER_URL` constant. Operator mode already required SeaweedFS creds
    (`assertArchived`), so this is strictly more consistent.
  - Header + inline docs updated; net effect keeps the file under the 500
    `max-lines` budget (the DRY S3-read helper offsets the additions).
- `.buildkite/pipeline.yml` — dropped `--site-version "2.0.0-$BUILDKITE_BUILD_NUMBER"`
  from both the PR dry-run (line ~869) and the real `scout promotion PR` step
  (line ~1188).

Verification (worktree): `bunx turbo run typecheck lint test --filter=@shepherdjerred/root-scripts`
green (87 tests + ci-changed + upload-pipeline selector tests); `prettier --check`
clean; `--ci --dry-run` smoke test exits 0 with the new message.

## Session Log — 2026-07-24

### Done

- Root-caused main red to the `sites`-lane / `scout-promotion`-lane `versions.ts`
  gating mismatch (see Diagnosis).
- Implemented the beta-marker-driven target-version fix in `promote-scout.ts` +
  pipeline (see Implementation). Verified locally (typecheck/lint/test/prettier).

### Remaining

- Open the PR via git-spice; drive its `buildkite/monorepo/pr` build green.
- Confirm main build #6042 (`d51e2a103`) finishes green; if the fix PR merges,
  the recurrence is closed.

### Caveats

- The immediate sentinel-path failure is already gone (PR #1603 promoted
  `scout-for-lol-site/prod` → `2.0.0-6017`), so #6042 may go green on its own —
  but this code fix is what prevents the next `versions.ts`-only bump from
  re-reddening main.
- Behavior change for operator mode's _default_ target: it now reads the beta
  **bucket** marker over S3 rather than the public HTTPS endpoint. Same value,
  but requires the SeaweedFS creds the documented `AWS_PROFILE=seaweedfs`
  invocation already supplies (and which `assertArchived` already needed).
