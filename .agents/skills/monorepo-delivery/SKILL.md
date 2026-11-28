---
name: monorepo-delivery
description: Deliver changes in this monorepo through Git-Spice, focused checks, Woodpecker CI, automated review, and PR evidence. Use for branches, commits, PRs, CI failures, review findings, or release-readiness claims.
---

# Monorepo delivery

Use `toolkit git-spice` (or `toolkit spice` in isolated Claude worktrees) for
every feature branch and PR operation. A single PR is a stack of one, and every
stack is a git-spice stack. Pass `--no-prompt` in agent shells, and never use
`gs`, hand-roll a stack rebase, create a feature PR with `gh pr create`, run
`gh stack` / `github/gh-stack`, or point PR bases into a chain (git-spice may
register submitted stacks with GitHub's native stack feature itself).

## Work locally

1. Inspect the current branch, worktree, and complete base diff. Preserve
   unrelated edits.
2. Run focused package tasks with Turbo while iterating, then for the whole
   diff: `bunx turbo run build typecheck test lint --filter='...[origin/main...HEAD]'`
   plus the root ratchets it skips (duplication, quality, unused code; about
   25 s): `bunx turbo run jscpd quality-ratchet knip --filter=//`.
3. Run the extended test tier for affected workspaces; Woodpecker does not run
   it on pull requests:
   `bun run verify:extended -- --filter='...[origin/main...HEAD]'` (or
   `bunx turbo run test:extended --filter='...[origin/main...HEAD]' --continue`).
   Pull requests also skip the Playwright lane (unless they change
   `ci/ci-playwright/**`): run `bun run e2e:affected` for the browser projects
   the committed diff touches (commit first; `-- --base <ref>` or `-- --all`;
   needs `bunx playwright install`), adding `-- --linux` for visual-snapshot
   projects (sjer.red). The Paper smoke runs only nightly; for a The Storm diff
   run `bun run --cwd packages/the-storm test:smoke`.
4. Capture `Demo` material so a reviewer skimming the PR immediately sees what
   changed and that it works, `before` from `main` first when a prior state
   exists. `references/demo-evidence.md` lists the capture for each surface;
   only purely mechanical chores write `None — <reason>`.
5. Stage exact paths and run `bunx lefthook run pre-commit` (enforces `jscpd`).
6. Commit as `type(scope): outcome`; body: `Why`, `What`, `Verification`.
7. Inspect the complete branch diff before submission.

Create the draft PR, upload `Demo` media, embed it in `## Demo`, then mark
ready once (`Why`, `What`, `Demo`, and `Verification` in the PR body):

```bash
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/pr-XXXXXX")"
toolkit git-spice branch submit --draft --no-prompt --no-web --title "type(scope): outcome" --body-file "$SCRATCH/pr-body.md"
toolkit pr asset "$SCRATCH/before.png" "$SCRATCH/after.png" --markdown
# Embed printed markdown in ## Demo of "$SCRATCH/pr-body.md", then mark ready:
toolkit git-spice branch submit --no-draft --no-prompt --no-web --body-file "$SCRATCH/pr-body.md"
toolkit ci wait --json
```

Pass `--body-file` rather than `--body "$(cat ...)"` so worktree guards never
reject command substitution (`toolkit spice` accepts the same flags in isolated
Claude worktrees). Parallel subagents must allocate an isolated `mktemp -d` or
agent-scoped scratch subdirectory — never share fixed `/tmp/*` or root
scratchpad filenames across concurrent agents. Draft pushes run bounded
preflight; `toolkit git-spice stack submit --update-only --no-prompt` updates an
existing stack. A green draft preflight is not merge evidence: wait for full
verification of the current head after marking it ready, and keep PR metadata
based on the whole branch, not the latest commit.

## Submit once

Each ready transition and push to a ready PR starts a full pipeline.

- Stay in draft until the checks in "Work locally" pass. Mark ready once, and
  batch review fixes into a single push.
- Land hub-registry edits (`packages/feature-flags/src/managed-flag-inventory.json`,
  `packages/ops-model/catalog-document.json` and `services.json`,
  `packages/version-catalog/src/catalog.json`) as their own small PRs so a
  feature PR does not re-run every dependent.
- A failure CI reports as inherited from main (check `toolkit ci explain <PR>`
  and the open incident the wait report names) is not yours to fix in the PR.
  Wait for main to recover (`toolkit ci wait --main --follow`), then restack
  onto the fixed main with `toolkit git-spice` and wait on the PR again. PR CI
  builds the PR head, so a re-run without a restack repeats main's old failure;
  only a failure main shows as environmental passes on a plain re-run.

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

  Use `toolkit ci explain <PR>` for bounded failure evidence, `toolkit ci load`
  for capacity, and `toolkit ci timings` / `toolkit ci analyze` for workflow
  p50/p90 latency and critical-path bottlenecks. Long queues and builds are
  normal; elapsed time alone is not a failure.

- **Pipeline cancellation:** Stop your own superseded PR pipelines via
  `toolkit woodpecker pipeline stop <ID>`. Never cancel another session's PR
  pipeline or any `main` push pipeline without explicit user approval.

- Wait exits distinguish CI failure (1), errors (2), human intervention (3),
  head changes (4), PR ready but main red (5), timeout (6), and closed/merged
  PRs (7). `pr land` adds 0 for merged and 8 for a failed merge. A red main
  never ends a wait early. If `main` or Delivery is red, the wait report names
  the open incident; follow `incident-response`: `toolkit incident take` when
  you caused it (mandatory), otherwise hold `toolkit incident wait` rather than
  duplicating recovery, and declare it when nothing is open. Resolve with
  authoritative CI or Delivery evidence (`delivery-recovery` for Delivery).
  Otherwise continue your assigned work. A timeout is not CI failure.
  A changed head requires an explicit new wait.
  Use `--until settled` when collecting all blocking results is useful.
  Full command and credential details live in `packages/toolkit/README.md`.
- Use `toolkit pr review list <PR> --json` for authors, priority, full feedback,
  and raw GitHub API commands. Do not infer CI status from GitHub Actions.
- Verify the exact PR head; a prior build or green sibling branch is no evidence.
- Source, CI, artifact publication, ArgoCD deployment, and live behavior are
  separate claims. Report each independently.
- Verification names the extended-tier run (command and result) or states that
  no affected workspace has extended steps; the nightly run is no substitute.
- Before pushing a review fix, list the finding and resolve or dismiss its
  thread with a specific audited reason when justified.
- Never change a real gate, skip a test, or suppress an error merely to make a
  PR green.

Upload `Demo` media with `toolkit pr asset [PR] <path...> --markdown`
(omitting `PR` infers the current branch's open PR) and embed the printed
markdown in the PR body's `## Demo` section before marking ready. A `.cast`
renders as an inline GIF linked to the full player; a directory with root
`index.html` uploads as a static demo site. Every PR reaches review with a
human-skimmable `## Demo` ("the diff is small" or "no client change" is not a
reason to omit it; test pass counts stay in `## Verification`, alongside any
unperformed live or production checks).

Complex work may use several commits inside this one branch. Use multiple
git-spice stacked PRs only when each branch is independently landable and the
requested scope permits more than one PR. Those stacks are still git-spice
stacks.

## Merge when authorized

Do not merge a PR unless the task authorizes it. For an authorized merge, use
`toolkit pr land <PR> --json`. It waits for exact-head readiness, then runs
`toolkit git-spice branch merge --method squash` for you.

## Close out

Before answering "are we done?" or ending the task, confirm each item and
finish any that remain in scope rather than listing it:

- every planned change is delivered, and nothing in the plan was deferred;
- authorized PRs are merged; others are named with their state;
- the PR body includes `## Demo` (before/after for changed UI/sites/docs, cast or
  concrete output for CLI/backend/infra), and the final report links it;
- a new feature's flag is on in the intended live environment;
- Tracker issues for friction, inefficiency, automation candidates, and tech
  debt found along the way are filed or upvoted, and named.

Deployment still moving through the normal release path does not hold the
session open; report which acceptance layers were verified and which remain.
