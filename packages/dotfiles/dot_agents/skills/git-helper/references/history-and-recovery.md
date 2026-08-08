# Git history and recovery

Read this when rebasing, comparing patch series, bisecting, recovering commits, moving stashes, using sparse checkout, or creating bundles.

## Range-diff

Compare an old and a new series with two explicit ranges:

```bash
git range-diff old-base..old-tip new-base..new-tip
```

Use `--remerge-diff` when reviewing conflict-resolution changes in merge commits **only when the installed `git range-diff -h` lists that option** (it was added in Git 2.48). On older Git versions, use the base `git range-diff old-base..old-tip new-base..new-tip` command above; it remains a useful review aid, although it cannot show the remerge-specific view. Patch pairing is heuristic and is not commit identity.

## Bisect

`git bisect run <command>` interprets exit codes as follows:

- `0`: good
- `1` through `127`, except `125`: bad
- `125`: skip this commit
- other termination or signal states: abort/error conditions

The test command must reliably distinguish good from bad. Do not append a blanket shell fallback that turns failures into a chosen result.

## Reflog

Reflogs record local reference movements. Inspect candidate commits and preserve one with a branch before changing the current ref.

Default expiry is generally 90 days for reachable entries and 30 days for unreachable entries, subject to configuration. Do not reverse those defaults or change them without a recovery policy.

## Stash interchange

Current Git supports exporting stash entries to a commit chain and importing that chain into another repository. Follow the installed `git stash export` and `git stash import` syntax; do not invent file-based `--to-ref` or import flags from older drafts.

A stash changes working-tree state. Agents should not use it to hide or move user work merely for investigation.

## Sparse checkout

Use `git sparse-checkout set` to initialize or change patterns; a separate `init` step is deprecated for most current workflows. `git sparse-checkout clean` is not available in older Git versions, so use it only when `git sparse-checkout -h` lists the `clean` subcommand. Before any cleanup, inspect tracked and untracked paths because it can remove paths outside the sparse specification. On versions without `clean`, there is no equivalent automatic cleanup: preserve user work and remove only individually reviewed, disposable untracked paths with the user's approval.

## Partial clones and backfill

`git backfill` can retrieve missing blobs in blobless partial clones in batches. Treat it as an evolving command and confirm the installed documentation before scripting it.

## Bundles and bundle URIs

`git bundle` creates and verifies portable repository object/ref bundles. Bundle URI is a clone/fetch bootstrap mechanism; do not describe it as a generic stash or backup transport.

```bash
git bundle create repository.bundle --all
git bundle verify repository.bundle
```

Verify prerequisites before treating a bundle as complete, and keep ordinary remote redundancy and backups separate from this transport artifact.

## Primary documentation

- [git-rebase](https://git-scm.com/docs/git-rebase)
- [git-range-diff](https://git-scm.com/docs/git-range-diff)
- [git-bisect](https://git-scm.com/docs/git-bisect)
- [git-reflog](https://git-scm.com/docs/git-reflog)
- [git-reset](https://git-scm.com/docs/git-reset)
- [git-restore](https://git-scm.com/docs/git-restore)
- [git-stash](https://git-scm.com/docs/git-stash)
- [git-sparse-checkout](https://git-scm.com/docs/git-sparse-checkout)
- [git-backfill](https://git-scm.com/docs/git-backfill)
- [git-bundle](https://git-scm.com/docs/git-bundle)
