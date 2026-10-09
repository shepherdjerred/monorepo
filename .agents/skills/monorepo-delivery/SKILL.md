---
name: monorepo-delivery
description: Deliver changes in this monorepo through Git-Spice, focused checks, Woodpecker CI, automated review, and PR evidence. Use for branches, commits, PRs, CI failures, review findings, or release-readiness claims.
---

# Monorepo delivery

Use `toolkit git-spice` for every feature branch and PR operation. A single PR
is a stack of one. Never use `gs` from non-interactive shells, hand-roll a stack
rebase, or create a feature PR with `gh pr create`.

## Work locally

1. Inspect the current branch, worktree, and complete base diff. Preserve
   unrelated edits.
2. Run focused package tasks with Turbo while iterating.
3. For a browser-visible change, render it with PinchTab and capture the proof
   now, not after review: `pinchtab screenshot -o <file>` for a state,
   `pinchtab record` for a flow. Other user-visible surfaces use their own tool
   — a rendered asset, a Discord acceptance message, terminal output.
4. Stage exact paths and run `bunx lefthook run pre-commit`.
5. Commit as `type(scope): outcome`. The primary commit body has `Why`, `What`,
   and `Verification`.
6. Inspect the complete branch diff before submission.

Create or update the PR explicitly:

```bash
toolkit git-spice branch submit --draft --dry-run --title "type(scope): outcome" --body "..."
toolkit git-spice branch submit --draft --title "type(scope): outcome" --body "..."
toolkit git-spice stack submit --update-only
```

Use a draft once the branch has a coherent first commit. Draft pushes run the
bounded preflight. When the change and focused checks are ready, trigger full
verification without another commit:

```bash
toolkit git-spice branch submit --no-draft
toolkit ci wait --json
```

A green draft preflight is not merge evidence. Wait for full verification of
the current head after marking it ready. Keep the final body based on the whole
branch, not the latest commit.

## Prove readiness

- Woodpecker is authoritative for CI. Use `toolkit ci wait <PR> --json` for
  merge readiness and `toolkit ci explain <PR>` for bounded failure evidence.
  Keep awaiting the same foreground process. Long queues and builds are normal;
  elapsed time alone is not a failure. Use `toolkit ci load` for capacity.
- Wait exits distinguish CI failure (1), errors (2), human intervention (3),
  head changes (4), red main (5), timeout (6), and closed/merged PRs (7).
  On red main, report the failure and await instructions; do not repair main.
  A timeout is not CI failure. A changed head requires an explicit new wait.
  Use `--until settled` when collecting all blocking results is useful.
  Full command and credential details live in `packages/toolkit/README.md`.
- Use `toolkit pr review list <PR> --json` for authors, priority, full feedback,
  and raw GitHub API commands. Do not infer CI status from GitHub Actions.
- Verify the exact PR head. A prior build or a green sibling branch is not
  evidence for the current commit.
- Source, CI, artifact publication, ArgoCD deployment, and live behavior are
  separate claims. Report each independently.
- Before pushing a review fix, list the finding and resolve or dismiss its
  thread with a specific audited reason when justified.
- Never change a real gate, skip a test, or suppress an error merely to make a
  PR green.

Attach the proof captured in step 3 with
`toolkit pr asset <PR> <path> --profile seaweedfs --markdown`. A change with a
visual or interactive surface reaches review with that artifact; "the diff is
small" is not a reason to omit it. Pure logic and internal refactors give exact
commands instead. State unperformed live or production checks in the PR body.

Complex work may use several commits inside this one branch. Use multiple
stacked PRs only when each branch is independently landable and the requested
scope permits more than one PR.
