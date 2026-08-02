---
title: Scout workflows
description: Five jobs that keep Scout's League of Legends data, assets, and images current — including the only agentic upkeep job and both auto-merge cases.
---

Scout depends on data Riot ships on its own clock: game versions, asset
bundles, season dates, queue rotations. Five workflows track that clock. They
follow the [shared clone→drift→PR pattern](/temporal/workflows/repo-upkeep/)
with three deliberate deviations: two auto-merge cases and one agentic job.

## Data Dragon refresh (`data-dragon`)

Two schedules, one workflow: a fast **version check** (06:00 Sun–Fri)
compares Riot's published version against the committed one and exits with a
metric when current; a **weekly refresh** (06:00 Sat) runs unconditionally.
On a new version, a 90-minute activity downloads ~3,500 image assets and
regenerates snapshot tests.

Two twists:

- **Image-only diffs are suppressed.** Riot's CDN returns nondeterministic
  bytes for unchanged images, so a diff touching only raster assets or
  snapshots sends an email instead of opening a churn PR.
- **It auto-merges** (`gh pr merge --auto`). A version bump is mechanical and
  snapshot-verified; blocking on human review would just delay every patch
  day.

## Season date refresh (`scout-season-refresh`)

Monday 07:00. The one **agentic** upkeep job: season/act dates exist in no
machine-readable feed, so a `claude -p` subprocess (claude-opus-5, web search
enabled) researches Riot's announcements and edits the season table. The
guardrails matter more than the agent:

- It may only touch an allowlisted set of files, and must never run git.
- It prints a `NO_DRIFT`/`DRIFTED` sentinel, but the activity computes real
  drift from `git status` — the model's self-report is advisory only.
- The PR is always human-reviewed, never auto-merged.

## Marketing showcase refresh (`scout-showcase-refresh`)

Monday 10:00. Regenerates the committed marketing showcase PNGs from curated
prod data. A diff whose only change is the embedded `generatedAt` timestamp
is suppressed — no weekly no-op PRs.

## Queue windows (`scout-queue-windows`)

Daily 06:45. Derives limited-queue availability windows from 21 days of real
match volume and proposes edits to `queue-windows.json`. Auto-merge is
**conditional on reversibility**: `open`/`reopen` edits (additive — worst
case, an empty queue is listed) auto-merge; any `close` edit retires a live
mode, so the job disarms auto-merge and waits for a human to confirm against
patch notes. One fixed proposal branch is reused across days, and the job
closes its own stale PR when drift disappears.

## Image GC (`scout-image-gc`)

Daily 04:00. Prunes match images older than 30 days from the Scout S3
buckets (SeaweedFS lifecycle rules can't filter by suffix, so this is a
workflow). It first fetches the showcase exemption manifest and **refuses to
prune at all if that fetch fails** — a previous run without the exemption
deleted 60% of the showcase's source images.

Sources: [`data-dragon.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/data-dragon.ts),
[`scout-season-refresh.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/scout-season-refresh.ts),
[`scout-queue-windows.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/scout-queue-windows.ts),
[`scout-image-gc.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/scout-image-gc.ts).
