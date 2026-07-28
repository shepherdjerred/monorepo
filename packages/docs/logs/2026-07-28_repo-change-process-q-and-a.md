---
id: log-2026-07-28-repo-change-process-q-and-a
type: log
status: in-progress
board: false
---

# Repository change process Q&A

## Summary

Explained the standard path for making a change in this monorepo:

1. Read the root and package-specific `AGENTS.md` files and load relevant skills.
2. Create an isolated worktree from `origin/main` for any PR-bound or non-trivial
   change.
3. Trust and initialize the worktree with the pinned toolchain, root Bun workspace
   install, generated artifacts, and Lefthook hooks.
4. Make focused changes, update documentation alongside code, and stage explicit
   paths.
5. Run focused package checks while iterating; the commit hook checks staged
   files and Buildkite runs the exhaustive repository gate.
6. Commit with a conventional `type(scope): description` message and use
   git-spice to create or update a draft stacked PR.
7. Include rendered screenshots or recordings for visible changes.
8. Address review and CI failures, land stack branches bottom-up, then sync and
   clean up the worktree after merge.

## Resource-usage follow-up

The user clarified that the earlier whole-machine hangs have not meaningfully
recurred since the repository moved to Turbo. Turbo's task graph, affected
filtering, and cache therefore appear to have mitigated the catastrophic
fork-storm failure mode described in the July 11 investigation.

The remaining workflow is still too aggressive for comfortable parallel local
agents. A live process snapshot caught concurrent repo-wide verification work
including Gitleaks at roughly 599% CPU, Prettier at 156%, Helm at 113%, and the
docs checker at 102%. The root `verify` script lists more than 30 tasks, and Turbo
has no explicit concurrency cap, so `--affected` can still launch several
expensive root checks at once.

Additional observations:

- A long-running `opencode --auto` process was using roughly 230% CPU and 2.2 GB
  RSS.
- Watchman was using roughly 4.3 GB RSS and 29–65% CPU. Its root watch covers the
  monorepo, including the nested `.claude/worktrees` directory, and the repository
  has no root `.watchmanconfig` exclusion.
- Ten linked feature worktrees occupied roughly 51 GB in aggregate.
- Current memory pressure was healthy at the time of inspection: 91% free, no
  swap activity, and no recorded thermal or performance warning.

Recommended workflow changes:

1. Make package-scoped checks the default during implementation.
2. Allow only one full local verification across all worktrees at a time.
3. Add a conservative Turbo concurrency cap for local verification.
4. Reserve the full root verification surface for the final gate and Buildkite.
5. Exclude nested worktrees from the root Watchman watch or move worktrees outside
   the watched repository root.
6. Require agents to announce heavy verification and avoid starting it while
   another heavy local job is active.

These changes should preserve Turbo's successful correctness and caching model.
The goal is smoother scheduling and lower sustained workstation load, not
replacing Turbo or weakening any verification gate.

## Implementation

The agreed boundary is:

- Local pre-commit checks inspect staged files only. Prettier and Gitleaks were
  already staged-file-aware; merge-marker, file-size, line-ending, environment
  variable, and automation-suppression checks now receive the staged path list.
- The root Turbo graph no longer runs from the pre-commit hook.
- Developers and agents run focused package build/typecheck/test/lint tasks
  during implementation.
- Buildkite runs the exhaustive root `bun run verify` graph for PRs as well as
  `main`; PR verification is no longer `--affected`.
- Root instructions and the git, git-spice, and worktree skills describe the
  same local-versus-CI boundary.

## Session Log — 2026-07-28

### Done

- Documented the current worktree, Bun, verification, git-spice, PR, CI, and
  cleanup workflow for the user.
- Confirmed the reported resource contention with live process, memory-pressure,
  Watchman, worktree, and verification configuration evidence.
- Identified unconstrained repo-wide verification and the root Watchman scope as
  the main workflow-level sources of avoidable local load.
- Recorded the user's clarification that Turbo has already prevented meaningful
  recurrence of the earlier whole-machine hangs.
- Implemented the changed-file-only local hook and exhaustive Buildkite PR gate
  in the `feature/local-changed-file-verification` worktree.
- Passed focused validation: 9 targeted Bun tests, the static Buildkite pipeline
  validator, the six-task `@shepherdjerred/root-scripts` Turbo surface, Markdown
  lint, Prettier, changed-path smoke checks, and `git diff --check`.
- The end-to-end staged-file hook completed in 0.50 seconds and Gitleaks scanned
  12.38 KB rather than the repository.
- Committed as `ci(root): keep local verification lightweight` and opened draft
  PR #1761.
- Buildkite build #6715 exercised all 213 root verification tasks and exposed
  one script-coverage regression. Moved the pure changed-path classifiers into
  the tested migration helper; the scripts coverage gate now passes at 92.50%
  functions and 92.70% lines.
- PR #1761 merged as `bf72c8bccfac14d00f6a861dd37fc1598b35c613`.
- Diagnosed merge-generated main build #6724: the production image push omitted
  the Buildx filesystem entitlement already used by the smoke phase for
  `/tmp/caddyfile.generated`.
- Centralized the Caddyfile bake entitlement arguments and applied them to both
  smoke and production push commands, with focused regression coverage.
- Passed 8 focused Bake-image tests, the five-task root-scripts typecheck/lint
  surface, the static pipeline validator, Markdown lint, Prettier, and
  `git diff --check` without running the exhaustive local verification graph.
- Restacked PR #1764 after overlapping PR #1765 merged. The merged implementation
  imported the executable Bake CLI into its test and main build #6728 failed
  script coverage at 80.48% functions and 80.32% lines.
- Resolved the overlap by keeping the entitlement behavior but moving the pure
  helper and production command builder into `migration-core.ts`; the exact
  script-coverage suite now passes at 92.50% functions and 92.70% lines.
- Restacked PR #1764 is conflict-free, and Buildkite build #6730 passed every PR
  gate on commit `6805faec1fe59ab7a745f779914d40f76f22c4ed`.

### Remaining

- Merge PR #1764, then confirm its merge-generated main build passes image push,
  release, deployment, reconciliation, and commit-back lanes.

### Caveats

- The main checkout already contains other untracked session logs; they were not
  modified.
- CPU percentages were point-in-time samples and the individual verification
  subprocesses were short-lived; the structural concurrency issue is confirmed
  by the root verification command and repeated samples.
- The exhaustive docs, Knip, Gitleaks, Prettier, package, and infrastructure
  gates were intentionally not run locally; this change assigns that full
  surface to Buildkite.
- PR #1765 fixed the production entitlement first, but its main build #6728
  failed because its test imported the executable Bake CLI into coverage; PR
  #1764 is the coverage-safe follow-up rather than a second runtime fix.
