---
name: git-spice-helper
description: |
  git-spice (gs) stacked-branch and stacked-PR workflow — the authoritative branch & PR reference for shepherdjerred/monorepo.
  Load BEFORE any branch-management op: creating branches, creating/updating/stacking/moving PRs, restacking, rebasing a stack, or syncing a branch with main — and whenever the user mentions git-spice, gs, stacks/stacking, or "open/create a PR".
---

# git-spice — stacked branches & stacked PRs

In this repo **every feature PR is created and managed with
[git-spice](https://abhinav.github.io/git-spice/)** (`gs`), as a stack. A single
PR is just a stack of one. You drive branches, restacks, and PRs with native
`git-spice` commands — never hand-rolled `git rebase --onto` and never a bare
`gh pr create` for feature work.

git-spice (by Abhinav Gupta, Go, GPL-3.0, currently **v0.31.x**, SemVer pre-1.0,
needs **Git ≥ 2.38**) is offline-first: it only touches the network to
push/pull/submit. All stack state lives in one local git ref, `refs/spice/data`.

## ⚠️ The binary is `git-spice`, not `gs` (Ghostscript trap)

Homebrew renamed the executable to `git-spice` and **dropped the `gs` binary**.
On this machine `gs` is defined two different ways:

- **Interactively** — `gs` is a fish *abbreviation* (`config.fish.tmpl`) that
  expands to `git-spice`. Great for humans at a prompt.
- **Non-interactively** (scripts, CI, and the **agent Bash tool**) the
  abbreviation does **not** expand, and `gs` resolves to
  `/opt/homebrew/bin/gs` → **Ghostscript** (a PostScript interpreter, pulled in
  by `mactex`). Running `gs …` from a script/agent will invoke the wrong tool.

**So: in every Bash/script/CI context call `git-spice` explicitly.** This skill
writes `git-spice` in all runnable command blocks for copy-paste safety; the
short `gs …` forms (e.g. `gs bc`, `gs ss`) are the interactive equivalents and
are listed in `references/command-reference.md`.

## When to load this skill — the gate

Load this skill **before** running any of the following in this repo:

- creating a branch (`git-spice branch create`, `git branch`, `git checkout -b`, `git switch -c`)
- creating / updating / stacking a PR (`git-spice … submit`, `gh pr create` for feature work)
- restacking / rebasing a stack (`git-spice … restack`, `git-spice … onto`, `git rebase`)
- syncing a branch with trunk (`git-spice repo sync`)

`git commit` for normal edits does not require it; branch/stack/PR *management* does.

## Mental model

- **trunk** — `main`. The only branch with no base.
- **base** — the branch a branch was created on top of. A stacked PR targets its
  base branch (its parent), **not** `main`.
- **stack** — a chain of branches each based on the one below: `main → A → B → C`.
- **downstack** — everything below the current branch (down to, excluding, trunk).
- **upstack** — everything above the current branch (recursively).
- **restack** — rebase a branch onto its (updated) base to keep the chain linear.
  git-spice does this for you; you almost never run raw `git rebase`.
- **CR / change request** — git-spice's forge-neutral word for a PR.

**git-spice is PR-per-branch, not PR-per-commit.** A branch can hold multiple
commits, and follow-up "address review feedback" commits stay separate from the
originals even across force-pushes. Squash-merging each PR still yields a clean,
atomic trunk history. Do **not** try to make one PR per commit — that's a
different tool's model.

## This repo's setup (shepherdjerred/monorepo)

| Thing | Value |
| --- | --- |
| Install | `brew install git-spice` (pinned in `packages/dotfiles/.Brewfile_darwin`) |
| Shorthand | `abbr gs git-spice` in fish (interactive only — see the Ghostscript trap above) |
| Trunk | `main` |
| Auth | `git-spice auth login` → **Service CLI** (reuses your `gh auth token`); CI uses the `GITHUB_TOKEN` env var |
| First-run | `git-spice repo init` once per clone/worktree (or let it auto-init on first use) |
| `branch create` commit | `spice.branchCreate.commit = false` is set in `~/.gitconfig` → `git-spice branch create <name>` makes **no** commit (a name is required); commit real changes after with `git-spice commit create -m "type(scope): …"` |
| Commit convention | `type(scope): description`; scope = a `packages/*` dir (e.g. `dotfiles`, `homelab`) or `root`/`deps`/`ci`/`practice`/`archive`/`dagger`/`cooklang`. Enforced by the `commit-msg` lefthook (`scripts/validate-commit-msg.ts`). This is exactly why the empty-commit default is turned off. |
| Worktrees | **One worktree per stack** — see `worktree-workflow` skill + root `AGENTS.md` |
| Required PR checks | `ci/merge-conflict` + `buildkite/monorepo/pr`, run **per PR** in the stack |

Why the commit-msg detail matters: `git-spice branch create` normally commits
immediately (an empty placeholder commit if nothing is staged). That placeholder
message is not `type(scope): …`, so the `commit-msg` hook would reject it. We set
`spice.branchCreate.commit = false` so branch creation never commits — never use
`--no-verify` to get around the hook.

### Auth setup (once)

```bash
git-spice auth login          # choose "Service CLI (gh)" → reuses `gh auth token`
git-spice auth status         # non-zero exit if logged out
```

Do **not** set `GITHUB_TOKEN` in your interactive shell: if that env var is set,
it overrides every other method and makes `git-spice auth login` fail. It's for
CI only.

## Core workflow (the daily loop)

All commands run inside the stack's worktree. Verify each branch
(`bun run verify -- --affected`) before you submit it.

### 1. Start / extend a stack

```bash
# The worktree already put you on feature/<slug> off origin/main (a stack of one).
# To add a branch ON TOP of the current one:
git-spice branch create feature/auth-api      # no commit (commit=false); name required
git add packages/…                            # stage the change
git-spice commit create -m "feat(scout): auth api"   # commit + auto-restack upstack
# repeat to keep stacking:
git-spice branch create feature/auth-ui
git add …
git-spice commit create -m "feat(scout): auth ui"
```

`git-spice log short` (`gs ls`) shows the stack; add `-a` for every tracked branch.

### 2. Navigate the stack (in place, one worktree)

```bash
git-spice down          # move to the branch below (git-spice up / top / bottom too)
git-spice up
git-spice branch checkout feature/auth-api   # jump to a specific branch
```

### 3. Submit the stack of PRs

```bash
git-spice stack submit --fill        # open/update a PR per branch; titles/bodies from commits
# scope variants: git-spice branch submit | upstack submit | downstack submit
```

Each PR targets its parent branch as base; git-spice posts a navigation comment
showing the stack. Use `--dry-run` first to preview, `--draft` for drafts,
`-r user,org/team` for reviewers.

### 4. Address review feedback

```bash
git-spice down                       # go to the branch under review
git add …                            # make the fix
git-spice commit amend               # or: git-spice commit create -m "…"  — both auto-restack the upstack
git-spice stack submit --update-only # force-push updates to existing PRs only
```

### 5. Sync after a PR merges

```bash
git-spice repo sync                  # pull main, delete merged branches, retarget survivors
git-spice repo sync --restack        # …and rebase the survivors onto the new base
```

`repo sync` is **repo-global** (it touches every tracked branch, not just this
worktree's stack) but safely skips branches checked out in other worktrees.

### 6. Reorder / move branches

```bash
git-spice upstack onto main          # move current branch + its upstack onto a new base
git-spice branch onto feature/x      # move ONLY the current branch
git-spice stack edit                 # reorder the whole (linear) stack in $EDITOR
git-spice branch create feature/mid --insert   # insert a branch into the middle
```

### 7. Resolve conflicts during a restack

git-spice pauses on conflict just like `git rebase`:

```bash
# …resolve the conflicted files, git add them…
git-spice rebase continue            # (gs rbc) resume the paused git-spice op
git-spice rebase abort               # (gs rba) revert to the pre-rebase state
```

## Safety rules (agent)

- **Never hand-roll a stack rebase.** Use `git-spice … restack` / `… onto` /
  `repo sync`, never `git rebase --onto`. git-spice tracks bases; manual rebases
  desync `refs/spice/data`.
- **Force-push is intrinsic** — every restack rewrites history, so submit
  force-pushes. git-spice uses safe force-push and refuses data-losing pushes;
  only pass `--force` when you understand why it's refusing. Only ever submit
  branches you own.
- **Keep stacks shallow** (≈≤4–5 branches). Each branch is its own PR with its
  own `buildkite/monorepo/pr` run, and every restack re-pushes → re-runs CI on
  the affected PRs. The **root of the stack must be independently landable**;
  feature-flag anything that would break a lower PR's CI on its own.
- **Verify before every submit:** `bun run verify -- --affected` on each branch.
- **`repo sync` / `repo restack` are repo-global.** In a multi-worktree session
  they act on all tracked branches; know what other stacks exist before running them.
- **Stack state is local and never pushed.** A fresh clone / CI / a teammate has
  no `refs/spice/data`. That's why automated bot PRs (Temporal, release
  automation) stay on plain `gh`, and why you manage a stack from the one machine
  that created it.
- **Don't bypass the commit-msg hook** with `git-spice … --no-verify`. Fix the
  message instead.

## Best practices (from the community)

- Small, atomic, single-purpose PRs **ordered to tell a story** — reviewers
  approve each fast and you never block waiting on review.
- Land **bottom-up**: merge the ready bottom PR, `git-spice repo sync --restack`,
  resubmit, repeat.
- Sync discipline: run `git-spice repo sync` after **any** merge so dependent
  branches retarget onto the new trunk.
- Reviewers need nothing installed — the output is ordinary GitHub PRs. Only the
  author needs git-spice.

## Troubleshooting

- **Squash-merge changed the hash → upstack looks wrong.** Expected: squash-merge
  rewrites the merged branch's commits into one new commit on trunk.
  `git-spice repo sync --restack && git-spice stack submit` fixes the upstack.
- **`fatal: Cannot rebase onto multiple branches`** during `repo sync` — a
  background git process (shell-prompt autofetch, an IDE) raced it. Just retry.
- **`git-spice auth login` fails immediately** — you have `GITHUB_TOKEN` set in
  the environment; unset it (it's CI-only and overrides everything).
- **"branch not restacked" refusal on submit** — the base moved. Restack
  (`git-spice branch restack`) or, for a fast-moving trunk, set
  `git config --global spice.submit.skipRestackCheck trunk` to submit anyway.
- **`git-spice stack submit` requested a wall of reviewers** — CODEOWNERS across
  the stack. Submit per-branch or manage reviewers deliberately with `-r`.

## References

- `references/command-reference.md` — every command, its shorthand (`gs bc`,
  `gs ss`, …), and key flags.
- `references/workflows.md` — worked end-to-end examples (build a stack, submit,
  review loop, land bottom-up, conflict walkthrough).
- `references/config.md` — the `spice.*` git-config keys used here and worth knowing.
- Official docs: <https://abhinav.github.io/git-spice/> · FAQ (PR-per-branch
  rationale): <https://abhinav.github.io/git-spice/resources/faq/>
- Related skills: `worktree-workflow` (one worktree per stack), `git-helper`
  (general git), `gh-helper` (PR reviews/comments/merge), `pr-health` / `pr-monitor`.
