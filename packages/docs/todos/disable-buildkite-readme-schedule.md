---
id: disable-buildkite-readme-schedule
status: waiting-on-verification
origin: packages/docs/plans/2026-06-13_temporal-readme-refresh.md
source_marker: false
---

# Disable the Buildkite "update-readmes" scheduled build in the Buildkite UI

## What

The README project-listing auto-update moved from a Buildkite scheduled build
(`.buildkite/scripts/update-readmes.sh`, now deleted) to the
`readme-refresh-weekly` Temporal schedule. The Buildkite **scheduled build** that
invoked that script is configured in the Buildkite UI, **not** in this repo — there
is no `buildkite_pipeline_schedule` Tofu resource for it. Deleting the script does
not stop the schedule from firing.

## Why it's open

Until the Buildkite schedule is disabled/deleted in the UI, it will keep triggering
builds that now fail (the script is gone) — noisy red builds for a job that has been
superseded.

## Next steps

1. In the Buildkite UI, find the pipeline + **scheduled build** that ran
   `update-readmes.sh` (cron that pushed `auto/update-readmes`).
2. Delete or disable that schedule.
3. Verify no further `auto/update-readmes` PRs / failing scheduled builds appear, and
   that the `readme-refresh-weekly` Temporal schedule has fired at least once and
   opened (or no-diff'd) a PR.
4. Resolve this todo (delete the file) once both are confirmed.
