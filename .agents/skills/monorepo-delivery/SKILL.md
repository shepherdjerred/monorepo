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
3. Run the extended test tier for affected workspaces; Woodpecker does not run
   it on pull requests:
   `bunx turbo run test:extended --filter='...[origin/main]' --continue`.
4. For a browser-visible change, render it with PinchTab and capture the proof
   now, not after review: `pinchtab screenshot -o <file>` for a state,
   `pinchtab record` for a flow. A terminal, CLI, or TUI change records an
   asciinema cast:
   `asciinema rec --headless --window-size 120x32 --idle-time-limit 2 --return --command '<cmd>' demo.cast`.
   Other user-visible surfaces use their own tool — a rendered asset or a
   Discord acceptance message.
5. Stage exact paths and run `bunx lefthook run pre-commit`.
6. Commit as `type(scope): outcome`. The primary commit body has `Why`, `What`,
   and `Verification`.
7. Inspect the complete branch diff before submission.

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

- Woodpecker is authoritative for CI. Each request has one blocking command;
  run it once and hold it as `~/AGENTS.md` describes for your harness:

  | Request                                  | Command                                 |
  | ---------------------------------------- | --------------------------------------- |
  | Get the PR's CI green                    | `toolkit ci wait <PR> --json`           |
  | Merge when ready / get green, then merge | `toolkit pr land <PR> --json`           |
  | Get main green / verify a merge on main  | `toolkit ci wait --main [--head <SHA>]` |
  | Wait until main is fixed                 | `toolkit ci wait --main --follow`       |
  | Watch a deployment                       | `toolkit deploy wait <ID>`              |

  Use `toolkit ci explain <PR>` for bounded failure evidence and
  `toolkit ci load` for capacity. Long queues and builds are normal; elapsed
  time alone is not a failure.

- Wait exits distinguish CI failure (1), errors (2), human intervention (3),
  head changes (4), PR ready but main red (5), timeout (6), and closed/merged
  PRs (7). `pr land` adds 0 for merged and 8 for a failed merge. A red main
  never ends a wait early. Keep working if main is red; do not try to fix main
  unless explicitly told. A timeout is not CI failure. A changed head requires
  an explicit new wait.
  Use `--until settled` when collecting all blocking results is useful.
  Full command and credential details live in `packages/toolkit/README.md`.
- Use `toolkit pr review list <PR> --json` for authors, priority, full feedback,
  and raw GitHub API commands. Do not infer CI status from GitHub Actions.
- Verify the exact PR head. A prior build or a green sibling branch is not
  evidence for the current commit.
- Source, CI, artifact publication, ArgoCD deployment, and live behavior are
  separate claims. Report each independently.
- Verification names the extended-tier run (command and result) or states that
  no affected workspace has extended steps. The nightly `ci-extended-verify`
  run on main is a safety net, not evidence for the PR.
- Before pushing a review fix, list the finding and resolve or dismiss its
  thread with a specific audited reason when justified.
- Never change a real gate, skip a test, or suppress an error merely to make a
  PR green.

Attach the proof captured in step 4 with
`toolkit pr asset <PR> <path> --profile seaweedfs --markdown` and embed the
printed markdown in the PR body's `Verification` section before marking the PR
ready. A `.cast` renders as an inline GIF linked to the full player. A change
with a visual or interactive surface reaches review with that artifact; "the
diff is small" is not a reason to omit it. Pure logic and internal refactors
give exact commands instead. State unperformed live or production checks in
the PR body.

Complex work may use several commits inside this one branch. Use multiple
stacked PRs only when each branch is independently landable and the requested
scope permits more than one PR.

## Merge when authorized

Do not merge a PR unless the task authorizes it. For an authorized merge, use
`toolkit pr land <PR> --json`. It waits for exact-head readiness, then runs
`toolkit git-spice branch merge --method squash` for you.

## Close out

Before answering "are we done?" or ending the task, confirm each item and
finish any that remain in scope rather than listing it:

- every planned change is delivered, and nothing in the plan was deferred;
- authorized PRs are merged; others are named with their state;
- the PR body embeds the visual proof, and the final report links it;
- a new feature's flag is on in the intended live environment;
- Tracker issues for friction, inefficiency, automation candidates, and tech
  debt found along the way are filed or upvoted, and named.

Deployment still moving through the normal release path does not hold the
session open; report which acceptance layers were verified and which remain.
