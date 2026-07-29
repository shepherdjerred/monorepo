---
id: log-main-ci-recovery-2026-07-29
type: log
status: in-progress
board: false
---

# Main CI recovery

## Objective

Restore the newest authoritative `main` Buildkite build without weakening tests,
quality gates, release safeguards, or deployment checks.

## Investigation

- `origin/main` at `78d0abbb9385782ced63e97c7d20ef457f55dca8`
  produced Buildkite #7203.
- The earliest hard failure was `verify` job
  `019fb023-a28c-4c3b-8198-8eb80823deac`.
- Its only failed Turbo task was `//#check-todos`, which reported:
  `plans/2026-07-29_scout-season-expiry-outage.md: in-progress board documents
require unchecked items in ## Remaining`.
- The plan recorded four unchecked tasks only under the session log's
  `### Remaining`, not the canonical top-level board workflow section.

## Session Log — 2026-07-29

### Done

- Loaded the repository Buildkite, git-spice, worktree, Git, and documentation
  guidance.
- Established that the newest merge-generated `main` build must pass all
  downstream lanes before completion.
- Isolated the work in `.claude/worktrees/main-ci-recovery` on
  `feature/main-ci-recovery`.
- Traced Buildkite #7203 to the exact failed job and invariant.
- Added the required top-level remaining-work inventory without changing the
  plan's status or dropping any open tasks.
- Passed `bun run check-todos` across all 1,036 workflow documents.
- Passed changed-file Prettier and markdownlint with the repository
  configuration.
- Passed the staged-file Lefthook safety suite, including Gitleaks, suppression,
  formatting, merge-marker, line-ending, and repository guard checks.

### Remaining

- Publish, merge, and verify the resulting merge-generated `main` build.

### Caveats

- Build numbers and remote CI state are time-sensitive and must be refreshed
  after every merge.
- Buildkite #7203's broken downstream jobs are dependency fallout from
  `verify`; they are not separate root causes.
- The `monorepo-docs` skill still names a nonexistent `bun run check-docs`
  script; the repository's authoritative command is `bun run check-todos`.
