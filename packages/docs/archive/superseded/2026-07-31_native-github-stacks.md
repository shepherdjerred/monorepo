---
id: reference-superseded-2026-07-31-native-github-stacks
type: reference
status: complete
board: false
---

# Native GitHub stacks for new work

> **Superseded (2026-08-03):** Reverted by PR #1970
> (`docs(root): prefer git-spice over native GitHub stacks (revert #1876)`).
> New human/agent work uses git-spice again — see the `git-spice-helper` skill
> and root `AGENTS.md`. Preserved here for the decision history; do not follow
> the `gh stack` guidance below for new work.

## Objective

Make GitHub's native stacked pull requests the default for newly rooted
human/agent work while preserving tool ownership for every branch or stack
already managed by git-spice.

## Decisions

| Area                    | Decision                                                                                                                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New feature work        | Use `gh stack`, including a one-layer stack for one PR.                                                                                                                                                                                            |
| Existing git-spice work | Keep using git-spice for the stack's full lifecycle.                                                                                                                                                                                               |
| Tool boundary           | Never register or operate one stack with both tools.                                                                                                                                                                                               |
| Automated PR creators   | Keep stateless, self-contained single-PR bots on plain `gh`.                                                                                                                                                                                       |
| Provisioning            | Track the `gh stack` extension and official `gh-stack` skill in the dotfiles so a fresh install can follow the mandate: a `run_once` chezmoi script installs the `github/gh-stack` extension and the skill is vendored under `dot_agents/skills/`. |
| Historical records      | Preserve completed work and handoffs that identify their actual git-spice owner.                                                                                                                                                                   |

## Implementation

- Update root and nested agent instructions with the sticky ownership rule.
- Provision the mandated tooling in the tracked dotfiles so a fresh install can
  follow it: a `run_once` chezmoi script installs the `github/gh-stack`
  extension, and the official `gh-stack` skill is vendored under
  `dot_agents/skills/` alongside the legacy `git-spice-helper` skill.
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
