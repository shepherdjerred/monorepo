---
title: GitHub PR workflows
description: The webhook-driven PR workflows — the required merge-conflict status, CI cancellation on close, and review-signal collection.
---

One HMAC-verified GitHub webhook receiver (`pr-bot.sjer.red`, subscribed to
`pull_request` and `push`) fans events out to independent workflows keyed by
PR and commit, so redelivered webhooks no-op.

## Merge-conflict check (`checkPrMergeConflictsWorkflow`)

The authority behind the **required** `ci/merge-conflict` status. A push to
`main` re-checks every open PR; a PR push checks just that PR. Conflicts are
computed with a real local `git merge-tree --write-tree` in a bare workdir —
never GitHub's lazy `mergeable` field, which is exactly the kind of
unreliable upstream signal the repo's engineering principles say not to
build on. A newer push terminates an in-flight check for the same target
rather than queueing behind it.

## Buildkite cancel (`cancelBuildkiteBuildsWorkflow`)

On PR close or merge: cancel still-active Buildkite builds for the head
branch. Bot PRs are deliberately included — Renovate churns the most CI of
anyone. A build finishing between list and cancel is a benign race, not an
error.

## Review-signal collector (`observeReviewSignalsWorkflow`)

Every 6 hours: snapshots what the external code-review provider did across
the ~30 most recently updated PRs — using the same `@shepherdjerred/code-review`
state model the CI review-gate runs, so the dataset and the gate can never
disagree about definitions. Emits Prometheus metrics and archives NDJSON to
S3 keyed by the Temporal run ID, so a retried run overwrites itself instead
of forking the dataset.

## The removed PR-bot fleet

Until 2026-07-31 this worker also ran an in-house multi-specialist review
pipeline, a summary commenter, a reaction-ingesting learning loop, and a
durable "get this PR green" babysitter. The review bot never left dry-run,
babysit sat dormant, and together they carried ~120 source files plus a
dedicated Redis, dashboards, and alert rules — so the whole fleet was removed
in [#1863](https://github.com/shepherdjerred/monorepo/pull/1863). PR review
is the CI review gate's job (an external provider); the three workflows above
are what earned their keep.

Sources: webhook ingress
[`github-webhook.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/event-bridge/github-webhook.ts),
workflows under
[`src/workflows/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/temporal/src/workflows).
