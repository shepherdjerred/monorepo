# Git release lifecycle

Read this when upgrading Git, adopting a recently added command, or evaluating a claim about Git 3 or future behavior.

## Current version

Git 2.55.0 is current as of the 2026-08-03 refresh. Verify the installed version and read every release note between it and the repository's pinned or deployed version.

Recent operationally relevant additions include:

- 2.46: `git config` subcommand interface, refs/reftable work, credential extensions.
- 2.48: `range-diff --remerge-diff`, remote HEAD following controls, published breaking-change tracking.
- 2.49: `backfill`, `clone --revision`, and object-management improvements.
- 2.50: ORT merge completion, `merge-tree --quiet`, and maintenance tasks.
- 2.51: stash interchange, `switch` / `restore` graduating from experimental status, pack improvements.
- 2.52: `last-modified`, `refs`, experimental repository information, and maintenance improvements.
- 2.53–2.55: consult the exact release notes for stabilization, corrections, deprecations, and newly introduced commands rather than extending an older chronology by inference.

Do not promise a Git 3 date. Planned changes can move or be revised. Use the project's `BreakingChanges` document for current intent.

## Research ledger

The following 44 official pages were fetched and inspected for this refresh:

1. [Git 2.55.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.55.0.adoc)
2. [Git 2.54.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.54.0.adoc)
3. [Git 2.53.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.53.0.adoc)
4. [Git 2.52.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.52.0.adoc)
5. [Git 2.51.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.51.0.adoc)
6. [Git 2.50.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.50.0.adoc)
7. [Git 2.49.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.49.0.adoc)
8. [Git 2.48.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.48.0.adoc)
9. [Git 2.47.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.47.0.adoc)
10. [Git 2.46.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.46.0.adoc)
11. [Planned breaking changes](https://github.com/git/git/blob/master/Documentation/BreakingChanges.adoc)
12. [git-config](https://git-scm.com/docs/git-config)
13. [git-worktree](https://git-scm.com/docs/git-worktree)
14. [git-switch](https://git-scm.com/docs/git-switch)
15. [git-restore](https://git-scm.com/docs/git-restore)
16. [git-stash](https://git-scm.com/docs/git-stash)
17. [git-maintenance](https://git-scm.com/docs/git-maintenance)
18. [git-sparse-checkout](https://git-scm.com/docs/git-sparse-checkout)
19. [git-clone](https://git-scm.com/docs/git-clone)
20. [git-fetch](https://git-scm.com/docs/git-fetch)
21. [git-push](https://git-scm.com/docs/git-push)
22. [git-rebase](https://git-scm.com/docs/git-rebase)
23. [git-merge-tree](https://git-scm.com/docs/git-merge-tree)
24. [git-refs](https://git-scm.com/docs/git-refs)
25. [git-repo](https://git-scm.com/docs/git-repo)
26. [git-last-modified](https://git-scm.com/docs/git-last-modified)
27. [git-history](https://git-scm.com/docs/git-history)
28. [git-format-rev](https://git-scm.com/docs/git-format-rev)
29. [git-url-parse](https://git-scm.com/docs/git-url-parse)
30. [git-backfill](https://git-scm.com/docs/git-backfill)
31. [git-pack-objects](https://git-scm.com/docs/git-pack-objects)
32. [git-gc](https://git-scm.com/docs/git-gc)
33. [git-fsck](https://git-scm.com/docs/git-fsck)
34. [git-reflog](https://git-scm.com/docs/git-reflog)
35. [git-bundle](https://git-scm.com/docs/git-bundle)
36. [git-credential](https://git-scm.com/docs/git-credential)
37. [git-hook](https://git-scm.com/docs/git-hook)
38. [githooks](https://git-scm.com/docs/githooks)
39. [git-update-ref](https://git-scm.com/docs/git-update-ref)
40. [git-range-diff](https://git-scm.com/docs/git-range-diff)
41. [git-init](https://git-scm.com/docs/git-init)
42. [git-whatchanged](https://git-scm.com/docs/git-whatchanged)
43. [git-bisect](https://git-scm.com/docs/git-bisect)
44. [git-reset](https://git-scm.com/docs/git-reset)
