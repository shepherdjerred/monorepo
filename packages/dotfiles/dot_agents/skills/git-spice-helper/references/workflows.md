# git-spice worked workflows (this repo)

All examples use `git-spice` (agent/script-safe). Interactively, `gs` is the
abbreviation. Run them from the checkout that manages the stack.

## Metadata gate

Before submitting a branch, inspect the complete `base...branch` diff and
answer these questions:

- Does every commit subject name a concrete behavior or result rather than an
  activity or placeholder?
- Does the primary commit explain `Why`, `What`, and `Verification`?
- Does the PR title describe the complete branch outcome?
- Does the PR body explain `Why`, `What`, and `Verification`, with exact checks
  and explicit live-test boundaries?
- Are required screenshots or recordings attached for user-visible changes?

`git-spice --fill` can provide a draft or comparison point, but it is not final
metadata. Compose the final title and body from the complete branch diff and
submit them explicitly.

## 0. One-time per clone

```bash
git-spice repo init            # trunk auto-detected as main; usually auto-runs
git-spice auth status || git-spice auth login   # Service CLI (gh) reuses `gh auth token`
```

## 1. A single PR (a stack of one)

This is the common case and matches the pre-git-spice flow.

```bash
# Start on feature/<slug> off origin/main.
git add packages/foo/…
git-spice commit create -m "fix(foo): reject invalid match data"
bun run verify -- --affected
git-spice branch submit --dry-run \
  --title "fix(foo): reject invalid match data" \
  --body "Why: ... What: ... Verification: ..."
git-spice branch submit \
  --title "fix(foo): reject invalid match data" \
  --body "Why: ... What: ... Verification: ..."
```

## 2. Build and submit a stack

```bash
# Bottom branch (feature/<slug>) already exists.
git add packages/scout/schema/…
git-spice commit create -m "feat(scout-for-lol): add authenticated report schema"

git-spice branch create feature/auth-api      # no commit (commit=false), name required
git add packages/scout/api/…
git-spice commit create -m "feat(scout-for-lol): expose authenticated report API"

git-spice branch create feature/auth-ui
git add packages/scout/web/…
git-spice commit create -m "feat(scout-for-lol): render authenticated report controls"

git-spice log short          # visualise: main → auth-schema → auth-api → auth-ui
# Repeat the explicit dry-run and submit commands from the single-PR workflow
# for each branch, using that branch's complete base...branch diff.
```

## 3. Review loop — amend a lower branch, propagate up

```bash
git-spice down                       # or: git-spice branch checkout feature/auth-api
git add packages/scout/api/…         # apply reviewer's fix
git-spice commit amend               # auto-restacks auth-ui onto the new auth-api
# (git-spice commit create -m "fix(scout-for-lol): reject expired auth sessions"
#  also works and keeps the feedback as its own meaningful commit)
bun run verify -- --affected
git-spice stack submit --update-only # force-pushes updates without --fill
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
