# git-spice worked workflows (this repo)

All examples use `git-spice` (agent/script-safe). Interactively, `gs` is the
abbreviation. Every example assumes you're inside the stack's worktree (see
`worktree-workflow` — **one worktree per stack**).

## 0. One-time per clone/worktree

```bash
git-spice repo init            # trunk auto-detected as main; usually auto-runs
git-spice auth status || git-spice auth login   # Service CLI (gh) reuses `gh auth token`
```

## 1. A single PR (a stack of one)

This is the common case and matches the pre-git-spice flow.

```bash
# The worktree already created feature/<slug> off origin/main and put you on it.
git add packages/foo/…
git-spice commit create -m "fix(foo): correct the thing"
bun run verify -- --affected
git-spice branch submit --fill        # opens ONE PR targeting main
```

## 2. Build and submit a stack

```bash
# Bottom branch (feature/<slug>) already exists from the worktree.
git add packages/scout/schema/…
git-spice commit create -m "feat(scout-for-lol): auth schema"

git-spice branch create feature/auth-api      # no commit (commit=false), name required
git add packages/scout/api/…
git-spice commit create -m "feat(scout-for-lol): auth api"

git-spice branch create feature/auth-ui
git add packages/scout/web/…
git-spice commit create -m "feat(scout-for-lol): auth ui"

git-spice log short          # visualise: main → auth-schema → auth-api → auth-ui
git-spice stack submit --fill   # 3 PRs; each targets the one below; nav comment added
```

## 3. Review loop — amend a lower branch, propagate up

```bash
git-spice down                       # or: git-spice branch checkout feature/auth-api
git add packages/scout/api/…         # apply reviewer's fix
git-spice commit amend               # auto-restacks auth-ui onto the new auth-api
# (git-spice commit create -m "fix(scout-for-lol): review nits" also works and keeps
#  the feedback as its own commit — often nicer for reviewers)
bun run verify -- --affected
git-spice stack submit --update-only # force-pushes updates to the existing PRs
```

## 4. Land the stack bottom-up

Merge the **bottom** PR through the normal GitHub flow (it targets `main` and must
pass `ci/merge-conflict` + `buildkite/monorepo/pr`). Then:

```bash
git-spice repo sync --restack        # deletes the merged branch, retargets + rebases the rest
git-spice stack submit --update-only # resubmit so the next PR now targets main
```

Repeat until the stack is empty.

## 5. Insert / reorder

```bash
# Insert a new branch between the current one and its upstack:
git-spice branch create feature/auth-mid --insert
git add …
git-spice commit create -m "feat(scout-for-lol): shared middleware"

# Move a branch (and everything above it) onto a different base:
git-spice upstack onto main

# Reorder the whole stack interactively:
git-spice stack edit
```

## 6. Conflict during a restack

```bash
git-spice repo sync --restack
# → git-spice pauses: "CONFLICT … resolve and run `git-spice rebase continue`"
#   edit the conflicted files
git add packages/…
git-spice rebase continue            # resumes; may pause again for the next branch
# or, to bail out entirely:
git-spice rebase abort
```

## 7. Import an existing branch / PR into a stack

```bash
gh pr checkout 1234                  # or: git checkout existing-branch
git-spice branch track               # base is guessed; override with -b <base>
# for a whole hand-built chain, check out the top branch then:
git-spice downstack track
git-spice branch submit              # git-spice adopts the existing open PR
```
