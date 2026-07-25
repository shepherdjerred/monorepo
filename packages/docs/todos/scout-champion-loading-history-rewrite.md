---
id: scout-champion-loading-history-rewrite
type: todo
status: planned
board: true
verification: human
disposition: active
origin: packages/docs/plans/2026-07-25_scout-drop-unused-skins.md
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
> [`plans/2026-07-25_repo-history-slim.md`](../plans/2026-07-25_repo-history-slim.md).
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

## Remaining

- [ ] Confirm all worktrees/open PRs are landed or safe to rebase.
- [ ] Run the rewrite on a fresh mirror clone (`git-filter-repo` is installed):

  ```bash
  git clone --mirror git@github.com:shepherdjerred/monorepo.git monorepo-rewrite.git
  cd monorepo-rewrite.git
  git filter-repo --force --filename-callback '
  return None if (b"/champion-loading/" in filename and not filename.endswith(b"_0.jpg")) else filename
  '
  ```

  The callback keeps `*_0.jpg` at every commit (still rendered at the tip) and
  drops only the non-zero blobs from all historical commits.

- [ ] Review the size delta, then coordinate the force-push + a re-clone / stack
      rebase across worktrees.

## Comment Log

- 2026-07-25: Filed from the scout-drop-unused-skins plan. Code cleanup shipped
  separately; this tracks the history surgery only.
