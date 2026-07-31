---
id: plan-2026-07-31-native-github-stacks
type: plan
status: in-progress
board: false
---

# Native GitHub stacks for new work

## Objective

Make GitHub's native stacked pull requests the default for newly rooted
human/agent work while preserving tool ownership for every branch or stack
already managed by git-spice.

## Decisions

| Area                    | Decision                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------- |
| New feature work        | Use `gh stack`, including a one-layer stack for one PR.                            |
| Existing git-spice work | Keep using git-spice for the stack's full lifecycle.                               |
| Tool boundary           | Never register or operate one stack with both tools.                               |
| Automated PR creators   | Keep stateless, self-contained single-PR bots on plain `gh`.                       |
| Provisioning            | Messaging only; the `gh stack` extension and official skill are already installed. |
| Historical records      | Preserve completed work and handoffs that identify their actual git-spice owner.   |

## Implementation

- Update root and nested agent instructions with the sticky ownership rule.
- Update the main-checkout reminder with the native initialization command and
  the existing-git-spice exception.
- Reframe the repository's branching, PR-health, and worktree skills so native
  stacks are the new-work default and git-spice is legacy-only.
- Keep generic `gh pr create` examples explicitly scoped to stateless bots,
  forks, or repositories outside this monorepo.
- Audit active future-facing plans against live branches and PRs before
  changing their tool references.
- Clarify the code-review comment that same-repository PRs may be native-stack,
  legacy git-spice, or stateless automation PRs.

## Bot audit

- Temporal refresh PRs run in fresh shallow clones, create a single
  self-contained PR, and retain no local stack state. Data Dragon also relies
  on auto-merge, which native stacked PRs do not support. Keep them on plain
  `gh`.
- Birmel's editor creates one user-requested PR from a fresh clone and does not
  manage a branch chain. Keep it on plain `gh`.
- Sandbox editor automation creates one API-backed PR with no local stack
  lifecycle. Keep it on plain GitHub PR creation.

## Verification

- Smoke-test the reminder in Claude and Codex output modes from the main
  checkout and confirm it remains silent from a linked worktree.
- Run ShellCheck on the reminder.
- Run targeted Prettier and Markdownlint checks for changed documentation.
- Run `bun run check-todos`.
- Run focused code-review package checks for the TypeScript comment change.
- Run the staged-file pre-commit hook.
- Audit remaining active `git-spice` and `gh pr create` references and classify
  each as legacy history, an existing stack, stateless automation, a fork, or
  generic non-monorepo guidance.

## Session Log — 2026-07-31

### Done

- Updated `AGENTS.md`, `packages/dotfiles/AGENTS.md`, the Claude hook, and the
  OpenCode reminder so newly rooted work uses native GitHub stacks while
  existing git-spice work retains its original owner.
- Reframed the repository's branching, worktree, PR-health, PR-monitoring, and
  PR-automation skills around the sticky stack-owner boundary; retained the
  git-spice skill and configuration for existing stacks.
- Audited plain-GitHub PR creators and documented Temporal refresh jobs,
  Birmel's editor, and the Claude Web sandbox as stateless single-PR
  exceptions. No bot behavior changed.
- Preserved active-plan git-spice references because those plans already
  record git-spice-owned work; live PR checks confirmed the ambiguous Liskov,
  Streambot, CI-observability, and Mario Kart references belong to earlier
  git-spice branches/PRs.
- Created native one-layer stack `feature/native-github-stacks`, published PR
  #1876, and verified its local stack state with `gh stack view --json`.
- Passed ShellCheck and reminder smoke tests, Markdownlint, `check-todos`,
  focused lint/typecheck for Code Review, Temporal, and Birmel, all 73 Code
  Review tests, a syntax build for the sandbox route, and diff checks.

### Remaining

- Let Buildkite and automated review evaluate the final PR head, then merge PR
  #1876 through the native stack workflow when it is approved.
- Apply the merged dotfiles source through the normal chezmoi flow so installed
  agent skill copies receive the new messaging.

### Caveats

- Existing git-spice stacks and their plans are intentionally unchanged; this
  change is not an implicit migration of branches between stack tools.
- Plain `gh` remains intentional for fresh-clone bots, API-only automation, and
  fork PRs.
- Temporal lint passes with 135 duplication warnings reported by its existing
  quality tooling.
- The Claude Web sandbox is excluded from the root workspace and its standalone
  `typecheck` points at a missing `sandbox/tsconfig.base.json`; the changed
  comment was instead parser-checked with a Bun syntax build.
- The user's dirty main checkout was not modified; all implementation work is
  isolated in `.claude/worktrees/native-github-stacks`.
