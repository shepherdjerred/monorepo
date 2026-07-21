---
id: plan-2026-07-19-git-spice-stacked-prs
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Adopt git-spice stacked PRs across AGENTS.md + skills

## Context

Every PR in the monorepo was created with bare `gh pr create --fill` (one branch →
one PR), and branch/PR guidance was spread across five skills plus the root
`AGENTS.md`. No stacked-PR tooling was wired in: `git-spice` (`gs`) had been used by
hand once but was not installed, pinned, documented, or taught anywhere.

Goal: all feature PRs are created and managed with git-spice **as stacks** (a single
PR is a stack of one), using native `gs` commands for stacking/restacking/moving/
syncing; a mandatory "load the skill first" gate before any branch-management op; and
a new git-spice skill authored from deep research (docs + source + HN/blogs).

## Decisions

| #   | Decision                             | Choice                                                                                                                                     |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Worktree × stack model               | **One worktree per stack** — single PRs unchanged; a stack's branches share one worktree so `gs` restack/sync/`up`/`down` work as designed |
| 2   | Install / pin `gs`                   | **Brewfile** — `brew "git-spice"` (+ `abbr gs git-spice` in fish; binary is `git-spice`)                                                   |
| 3   | Existing-skill edits                 | **Pointer only** — new skill + a banner in each of the 5 skills; leave their `gh pr create` examples                                       |
| 4   | `gs branch create` commit-hook clash | **Bake into gitconfig** — `spice.branchCreate.commit = false`                                                                              |

## Key facts (verified this session)

- git-spice **v0.31.0 already installed** (Homebrew formula `git-spice`); `gh`
  authed as `shepherdjerred` with `repo`/`workflow` scopes.
- **`gs` = Ghostscript** (`/opt/homebrew/bin/gs`, v10.07.1, via `mactex`)
  non-interactively — the fish `abbr gs git-spice` is interactive-only. Scripts,
  CI, and the agent Bash tool must call `git-spice` explicitly. (This also explains
  the "gs 10.07.1" in the 2026-07-10 quality-waves plan — that was Ghostscript's
  version, not git-spice's.)
- Hooks **do** exist: `lefthook.yml` has a real `commit-msg` job
  (`scripts/validate-commit-msg.ts`) + `pre-commit`/`pre-push`, installed and armed.
  The `git-helper` "hooks removed 2026-07" line is stale.
- git-spice state is one local ref `refs/spice/data`, shared repo-wide across
  worktrees, **never pushed** — so automated bot PRs stay on `gh`.

## Implementation (built this session)

- **New skill** `packages/dotfiles/dot_agents/skills/git-spice-helper/` — `SKILL.md`
  (gate skill: overview, Ghostscript trap, mental model, repo setup, core workflow,
  safety rules, best practices, troubleshooting) + `references/command-reference.md`,
  `references/workflows.md`, `references/config.md`.
- **Dotfiles wiring:** `brew "git-spice"` in `.Brewfile_darwin`; `abbr gs git-spice`
  in `config.fish.tmpl`; `[spice "branchCreate"] commit = false` in
  `private_dot_gitconfig.tmpl`.
- **Root `AGENTS.md`:** reframed "Parallel Work — Use Worktrees" (worktree holds a
  stack; git-spice manages branches/PRs; the gate) and the "GitHub CLI" section
  (feature PRs via `gs`, bots stay on `gh`).
- **Global `packages/dotfiles/AGENTS.md`:** skill-load gate bullet under "Tool &
  Skill Usage — MANDATORY".
- **`.claude/hooks/worktree-reminder.sh`:** reminder now says the worktree holds a
  git-spice stack; load `git-spice-helper`.
- **Pointer banners** on `worktree-workflow`, `git-helper`, `pr-monitor`,
  `pr-workflow-automation`, `pr-health`.

## Verification

- End-to-end `git-spice` round-trip in a scratch repo: `branch create` with
  `commit=false` makes no commit; `commit create` commits; stacking + `gs down` +
  `commit amend` auto-restacked the upstack.
- `validate-commit-msg.ts`: `feat(dotfiles): …` → exit 0; placeholder `feat-a`
  → rejected (exit 1) — confirms `commit=false` is necessary + sufficient.
- `bun run verify -- --affected` + markdownlint/prettier on changed files.

## Remaining

- [x] Submit the stack and open the PR — [#1588](https://github.com/shepherdjerred/monorepo/pull/1588).
- [x] Reconcile the stale "no CI" claims in `pr-monitor`/`pr-workflow-automation`/`pr-health` — fixed in #1588 per Greptile review.
- [ ] After merge, make the dotfiles changes live: `chezmoi apply` (Brewfile, fish, gitconfig, skills, global AGENTS.md) and `brew bundle` if `git-spice` is missing on a machine.
- [ ] Optional follow-up (separate doc/PR): the `git-helper` "hooks removed 2026-07" line is also stale (lefthook hooks exist) — out of scope for this PR, not touched by it.

## Session Log — 2026-07-19

### Done

- Authored the `git-spice-helper` skill + 3 references; wired `gs` into dotfiles (Brewfile, fish abbr, gitconfig `spice.branchCreate.commit=false`); updated the root and global `AGENTS.md`, the worktree-reminder hook, and added pointer banners to 5 skills. Verified git-spice mechanics + the commit-msg interaction end-to-end.
- Branch: `feature/git-spice-stacked-prs` (worktree `.claude/worktrees/git-spice-stacked-prs`).

### Remaining

- See `## Remaining` above (submit PR pending go-ahead; post-merge `chezmoi apply`).

### Caveats

- `gs` is Ghostscript non-interactively; all docs/skill use `git-spice` in runnable blocks.
- Pointer-only scope leaves the existing `gh pr create` examples in the 5 skills in place; the stale "no CI" lines in `pr-monitor`/`pr-workflow-automation`/`pr-health` were fixed per Greptile review (see Remaining), but `git-helper`'s "hooks removed" line remains a follow-up.
- The gitconfig/Brewfile/fish/skill changes are chezmoi **source**; they take effect after `chezmoi apply` (or merge + apply).
