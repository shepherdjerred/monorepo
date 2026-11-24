---
name: monorepo-delivery
description: Deliver changes in this monorepo through Git-Spice, focused checks, Woodpecker CI, automated review, and PR evidence. Use for branches, commits, PRs, CI failures, review findings, or release-readiness claims.
---

# Monorepo delivery

Use `toolkit git-spice` (or its `toolkit spice` alias in isolated Claude
worktrees, where the worktree guard refuses `git-spice` operands) for every
feature branch and PR operation. A single PR is a stack of one. Always pass
`--no-prompt` in agent shells so PTY sessions never block on interactive input,
and never use `gs`, hand-roll a stack rebase, or create a feature PR with
`gh pr create`.

## Work locally

1. Inspect the current branch, worktree, and complete base diff. Preserve
   unrelated edits.
2. Run focused package tasks with Turbo while iterating.
3. Run the extended test tier for affected workspaces; Woodpecker does not run
   it on pull requests:
   `bun run verify:extended -- --filter='...[origin/main...HEAD]'` (or
   `bunx turbo run test:extended --filter='...[origin/main...HEAD]' --continue`).
4. Capture `Demo` material so a reviewer skimming the PR immediately sees what
   changed and that it works (when a prior state exists, capture `before` from
   `main` first — before editing, from a `main` worktree, or `git stash` — with
   the same route, viewport, and input as `after`):
   - **Existing UI / page / layout:** `| Before | After |` table of screenshots
     (`toolkit screenshot <package> [route]` or isolated `PINCHTAB_SESSION`
     `pinchtab screenshot -o <file>`, closing tabs when done), plus a short
     `.mp4`/`.webm` (`pinchtab record`) when an interaction, sheet, form, or
     transition changed.
   - **New UI / responsive / static site / report:** key states (populated,
     empty, error/edge; desktop + mobile when layout matters) or a
     self-contained `.html` file / static directory (`index.html` at root).
   - **CLI / TUI / script:** asciinema `.cast`
     (`asciinema rec --headless --window-size 120x32 --idle-time-limit 2 --return --command '<cmd>' demo.cast`)
     or concise before/after terminal output.
   - **Backend / API / data / Temporal / homelab:** concrete observable output —
     before/after payload/event diff, `duckdb -markdown` query table, `uplot`
     chart, GitHub `mermaid` / `mmdc` diagram of changed flow/state/topology,
     `cdk8s`/`tofu`/SQL plan diff excerpt, or a short `.cast`. Never skip `Demo`
     because no frontend file changed; only purely mechanical chores write
     `None — <reason>`.
   - **Other surfaces:** matching rendered asset or Discord acceptance message.
5. Stage exact paths and run `bunx lefthook run pre-commit`.
6. Commit as `type(scope): outcome`. The primary commit body has `Why`, `What`,
   and `Verification`.
7. Inspect the complete branch diff before submission.

Create the draft PR, upload `Demo` media, embed it in `## Demo`, then mark
ready (`Why`, `What`, `Demo`, and `Verification` in the PR body):

```bash
toolkit git-spice branch submit --draft --no-prompt --no-web --title "type(scope): outcome" --body-file /tmp/pr-body.md
toolkit pr asset before.png after.png --profile seaweedfs --markdown
# Embed printed markdown in ## Demo of /tmp/pr-body.md, then mark ready:
toolkit git-spice branch submit --no-draft --no-prompt --no-web --body-file /tmp/pr-body.md
toolkit ci wait --json
```

Pass `--body-file` rather than `--body "$(cat ...)"` so worktree guards never
reject command substitution (`toolkit spice` accepts the same flags in isolated
Claude worktrees). Draft pushes run bounded preflight;
`toolkit git-spice stack submit --update-only --no-prompt` updates an existing
stack. A green draft preflight is not merge evidence: wait for full verification
of the current head after marking it ready, and keep PR metadata based on the
whole branch, not the latest commit.

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
  never ends a wait early. If `main` or Delivery is red, inspect failure
  evidence and active threads with `toolkit forum list --json`. Follow an
  existing owner (`toolkit forum watch <FM-N> --until-resolved`) rather than
  duplicating recovery. You must repair failures your changes caused, and may
  pick up an unowned failure you did not cause when it blocks your PR or
  release, no better active owner is handling it, and nobody else is working on
  it — claim or post a `notice` (`--owner me`) first, then resolve it with
  authoritative CI or Delivery evidence (`delivery-recovery` for Delivery).
  Otherwise continue your assigned work. A timeout is not CI failure.
  A changed head requires an explicit new wait.
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

Upload `Demo` media with `toolkit pr asset [PR] <path...> --profile seaweedfs --markdown`
(omitting `PR` infers the current branch's open PR) and embed the printed
markdown in the PR body's `## Demo` section before marking ready. A `.cast`
renders as an inline GIF linked to the full player; a directory with root
`index.html` uploads as a static demo site. Every PR reaches review with a
human-skimmable `## Demo` ("the diff is small" or "no client change" is not a
reason to omit it; test pass counts stay in `## Verification`, alongside any
unperformed live or production checks).

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
- the PR body includes `## Demo` (before/after for changed UI/sites/docs, cast or
  concrete output for CLI/backend/infra), and the final report links it;
- a new feature's flag is on in the intended live environment;
- Tracker issues for friction, inefficiency, automation candidates, and tech
  debt found along the way are filed or upvoted, and named.

Deployment still moving through the normal release path does not hold the
session open; report which acceptance layers were verified and which remain.
