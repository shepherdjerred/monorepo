---
id: log-prefer-git-spice-over-native-stacks-2026-08-03
type: log
status: complete
board: false
---

# Prefer git-spice over native GitHub stacks (revert #1876)

## Objective

Reverse the repo's stacked-PR guidance so **git-spice** is once again the single
mandated tool for human/agent feature work, undoing PR #1876
(`4210aab5c` — "docs(root): adopt native GitHub stacks for new work"), which had
switched the default to GitHub's native `gh stack` and vendored an 891-line
`gh-stack` skill plus chezmoi provisioning.

The user chose a **full revert** (git-spice-only) over a symmetric flip
(keep `gh-stack` as a secondary option).

## Approach

A clean `git revert 4210aab5c` applied with **zero conflicts** despite 39
commits since #1876. This is the authoritative way to restore the exact
pre-#1876 wording across every guidance surface rather than hand-editing 29
files. Auto-merge preserved all legitimate later work in the overlapping files.

## What the revert restored

- **Root `AGENTS.md`** — feature PRs are created/updated with git-spice (stacks,
  not `gh pr create`); a worktree holds a git-spice stack; `git-spice-helper` is
  the authoritative branch/PR skill; post-merge cleanup uses `git-spice repo
sync`.
- **`packages/dotfiles/AGENTS.md`** — branch & PR management loads
  `git-spice-helper` first; every PR is a git-spice stack.
- **All PR/worktree skills** (`git-spice-helper`, `worktree-workflow`,
  `pr-monitor`, `pr-workflow-automation`, `pr-health` in both dotfiles and
  toolkit, `git-helper`, `gh-helper`) — headers/routing notes restored to
  git-spice-authoritative; `gh-helper`/`git-helper` `gh pr create` examples are
  the generic non-monorepo fallback again.
- **`git-spice-helper` SKILL** — title/description/gate restored to
  "authoritative branch & PR reference," not "existing stacks only."
- **Hooks** — `.claude/hooks/worktree-reminder.sh` and
  `.opencode/plugins/worktree-reminder.js` no longer emit `gh stack` instructions.
- **`packages/temporal/AGENTS.md`** — deterministic PR-creating workflows note
  reverted to its shorter pre-#1876 form.
- **Comment-only code reverts** — `packages/birmel/src/editor/github-pr.ts`,
  `packages/code-review/src/head-pushed-at.ts`,
  `packages/temporal/src/activities/data-dragon.ts`,
  `packages/temporal/src/activities/scout-season-refresh-git.ts`,
  `sandbox/practice/claude-web/src/server/routes/sessions.ts`.

## What the revert deleted

- `packages/dotfiles/dot_agents/skills/gh-stack/SKILL.md` (891 lines).
- `packages/dotfiles/run_once_after_install-gh-extensions.sh` (chezmoi
  provisioning for the `github/gh-stack` extension) and its
  `scripts/script-migrations.json` retain entry.
- `packages/docs/plans/2026-07-31_native-github-stacks.md` (the #1876 plan) —
  the bare `git revert` deleted it outright; per docs archival policy a
  superseded plan is archived, not dropped, so it was restored to
  `packages/docs/archive/superseded/2026-07-31_native-github-stacks.md`
  (`type: reference`, `status: complete`) with a supersession note pointing
  back at this PR.

## Fix-ups after the automated review

- `packages/docs/plans/2026-08-02_buildkite-bootstrap-oom-longterm-fix.md:122`
  and `packages/docs/plans/2026-08-02_pr-fleet-observability-replay.md:19,137`
  are active `status: in-progress` plans that still called for `gh stack
init`/a "native GitHub stack." Updated both to the git-spice equivalent
  (`git-spice branch track <branch> --base main`, "git-spice stack layers") so
  an agent resuming either plan follows the now-current workflow.
- Root `AGENTS.md:362` (worktree setup sequence): the fresh-worktree bash block
  created `feature/<slug>` with raw Git but never registered it with
  git-spice. Added `git-spice branch track feature/<slug> --base main` right
  after entering the worktree so it's the tracked bottom of a one-layer stack
  before any `branch create`/`branch submit`.
- `packages/dotfiles/dot_agents/skills/pr-monitor/SKILL.md` — the numbered
  `## Workflow` steps (not just the reference examples further down)
  contradicted the skill's own git-spice-mandatory banner: step 1 said "Create
  PR with `gh pr create`" and step 2B said "merge from main." Routed both
  through git-spice (`git-spice branch submit`; `git-spice repo sync
--restack` + `git-spice rebase continue` on conflict).

## Verified

- Revert applied cleanly (exit 0, no conflict markers).
- Post-#1876 work in overlapping files is intact: Scout Data Dragon 16.15.1
  bump (#1827), Temporal→PagerDuty alerting section (#1861), PR Fleet Controller
  section in root `AGENTS.md` (#1855) — diffs vs `origin/main` show only the
  #1876 additions removed.

## Deliberately out of scope

- **`packages/pr-fleet-controller`** still references `gh-stack`/`gh stack` in
  `src/git-operations.ts` and `packages/docs/todos/pr-fleet-controller-sandbox-hardening.md`.
  That package (added later by #1855) _classifies and defensively refuses to
  rebase_ PRs owned by another tool; its native-stack awareness is runtime safety
  logic, not workflow guidance, and stays correct even under a git-spice-only
  policy. Simplifying it is a separate decision, noted here as a possible
  follow-up.
- **User's private global `~/.claude/CLAUDE.md`** (outside this repo) still
  instructs agents to use `gh-stack` for new work — flagged to the user; not
  edited because it is outside the repo and personal.
- **Live installed skills** under `~/.claude/skills/` (chezmoi-applied copies of
  the dotfiles skills) still carry the #1876 wording until `chezmoi apply` runs
  after this merges.

## Session Log — 2026-08-03

### Done

- Reverted PR #1876 in worktree `feature/prefer-git-spice` via
  `git revert 4210aab5c` (29 files; git-spice restored as the single mandated
  stacking tool, `gh-stack` skill + provisioning + plan doc removed).
- Verified no legitimate post-#1876 work was clobbered.
- Wrote this session log.

### Remaining

- Open the PR with git-spice and drive it to green (dogfooding the restored
  guidance).
- Decide whether `packages/pr-fleet-controller` gh-stack handling should be
  simplified (separate follow-up).
- After merge: `chezmoi apply` to sync the live installed skills; update the
  user's private global `~/.claude/CLAUDE.md` if they want it aligned.

### Caveats

- `gh-stack` extension may remain installed on machines that already ran the
  (now-deleted) provisioning script; harmless, uninstall manually if desired
  (`gh extension remove github/gh-stack`).
