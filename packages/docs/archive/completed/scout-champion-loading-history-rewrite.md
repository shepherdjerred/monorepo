---
id: scout-champion-loading-history-rewrite
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-25_scout-drop-unused-skins.md
source_marker: false
---

# Purge non-zero champion-loading skin blobs from git history

## Context

PR "scout: stop downloading unused champion skins" (branch
`feature/scout-drop-unused-skins`) deleted the 1,932 non-zero champion loading
screen JPGs from the working tree and stopped downloading them. But those blobs
(~108 MB across 48 commits, ~10% of the 1.0 GB `.git`) still live in git
history, so fresh clones stay large.

This is the **deferred, coordinated** history rewrite from that plan. It was
intentionally split out because it force-pushes a rewritten `main` and strands
in-flight work.

> **Superseded / absorbed** by
> [`2026-07-25_repo-history-slim.md`](./2026-07-25_repo-history-slim.md).
> That plan runs the same rewrite but with an **aggressive** scope — champion-loading
> is now just one target alongside scout-showcase, report snapshots, and ~124 MB of
> already-deleted dead content. Execute via that plan, not this todo alone; this file
> remains only as the champion-loading-specific record.

## Blast radius (read before running)

- Rewrites **every commit SHA from `2f721e34f` forward** (the first
  champion-loading commit) → requires a force-push to `origin/main`.
- **Strands every active worktree + open PR** based on current `main` — each
  must be rebased/re-created onto the rewritten history. Do this only when the
  stack of worktrees/PRs is quiescent (nothing important in flight).
- Invalidates any SHA references in release-pair tags, docs, and Buildkite build
  refs (historical only — already-deployed artifacts are unaffected).
- **GitHub does not GC server-side on force-push.** The remote repo stays large
  until GitHub's own GC runs (may need a support request). The immediate benefit
  is smaller _fresh clones_ once GitHub reclaims the unreachable blobs.

## Resolution

The standalone skins-only rewrite is retired. Its remaining work was absorbed
into `packages/docs/archive/completed/2026-07-25_repo-history-slim.md`, which coordinates
all history-slim targets, controlled refs, backups, atomic publication, and
git-spice recovery in one operation. Do not execute the narrower callback from
this historical record.

## Comment Log

- 2026-07-25: Filed from the scout-drop-unused-skins plan. Code cleanup shipped
  separately; this tracks the history surgery only.
- 2026-07-25: Marked complete and archived after the work was absorbed by the
  repo-wide history-slim plan.
