---
id: log-2026-07-30-scout-classic-beta-deployment-check
type: log
status: complete
board: false
---

# Scout Classic beta deployment check

The League Classic reports change is not in the currently deployed beta release.

- PR #1849 merged at `1e4f41f738b17120d56644c22e98069f927f4a0b` into `chore/scout-data-dragon-16.15.1-6d94e121`, rather than `main`.
- The current beta release is `2.0.0-7353`, produced by passed Buildkite build #7353 from main commit `1e77640c11f9aa37e705721927476960f198e910`.
- GitHub's comparison of those commits reports that their histories diverge, so build #7353 cannot contain the Classic merge.
- Argo CD reports `scout-beta` as Synced and Healthy; its running backend image is `ghcr.io/shepherdjerred/scout-for-lol:2.0.0-7353@sha256:4efb247fd4f1e1cbdc56d1f0cd84587111553fff36d8ab8f61eb59e1beb6bb75`. The beta site's `.release-version` marker matches build #7353's recorded release-input digest.

## Session Log — 2026-07-30

### Done

- Verified PR #1849's merge target and commit.
- Verified current Buildkite release state, Argo CD state, running beta image, and beta site release marker.
- Verified that the red-looking entries on PR build #7254 are intentionally not-run main-only steps, while every PR-relevant check passed.
- Confirmed the static Buildkite pipeline declares both PR and main lanes; main-only lanes are guarded with `if: build.branch == pipeline.default_branch`, which leaves them visible but not run on PR builds.
- Inspected the raw Buildkite job records: the red rows are API state `broken` with no runnable, start, finish, agent, exit code, or log. They were conditionally prevented from running, but the pipeline currently presents that non-execution as red rather than skipped.

### Remaining

- Merge the Classic change's containing branch into `main`; then verify the resulting main Buildkite release and beta deployment.

### Caveats

- Healthy and Synced confirm beta is serving release 2.0.0-7353, not that the unmerged Classic source is present.
- GitHub no longer reports required checks for the merged PR branch, so Buildkite build #7254 is the authoritative historical check record.
