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
- PR #1852 merged as `1daec4ea6580980785a6d603db407ceb4b57afd9`,
  whose exact merge-generated Buildkite #7208 passed `verify` and all build,
  test, image, Helm, and core infrastructure lanes.
- Buildkite #7208 then failed `argocd-sync` because the `media` application
  remained `Synced` but `Progressing` for its five-minute health deadline.
- The live rollout showed `media-qbittorrent` blocked in its
  `qbittorrent-config-seed` init container. Its fail-on-drift guard reported
  that the persisted qBittorrent limits are 20 active downloads, 20 active
  uploads, and 40 active torrents, while Git still declared 10, 10, and 20.

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
- Published and merged PR #1852, then followed its exact merge-generated main
  build through every downstream gate.
- Diagnosed Buildkite #7208's ArgoCD timeout to the exact unhealthy pod, init
  container, and three drifted managed keys without mutating the live cluster.
- Updated the committed qBittorrent source of truth to the persisted operator
  values, preserving the fail-on-drift guard.

### Remaining

- Publish the qBittorrent GitOps reconciliation and verify its PR build.
- Merge it and verify the newest exact merge-generated `main` build, including
  ArgoCD health and all downstream release gates.

### Caveats

- Build numbers and remote CI state are time-sensitive and must be refreshed
  after every merge.
- Buildkite #7203's broken downstream jobs are dependency fallout from
  `verify`; they are not separate root causes.
- Buildkite #7208 is genuinely red: its ArgoCD health gate correctly caught a
  production qBittorrent config drift that prevented the new pod from starting.
- The `monorepo-docs` skill still names a nonexistent `bun run check-docs`
  script; the repository's authoritative command is `bun run check-todos`.
