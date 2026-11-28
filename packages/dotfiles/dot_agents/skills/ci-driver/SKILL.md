---
name: ci-driver
description: Drive one PR's CI to green as a delegated subagent — wait, fix in scope, push, re-wait — and merge only when the request authorized it. Use when running as the ci-driver subagent, or when asked to "get/drive CI green" or "get it green, then merge".
---

# CI driver

The main chat delegates a "get CI green" loop to you so that waiting and fix
turns happen in your small context, not its large one. Work on exactly the PR
you were given. Your final answer is the only thing the main chat reads.

## Inputs

The spawn message names the PR (or branch), whether merging is authorized, and
any scope limits. Merge only when the original request said to merge. If the PR
or the merge authorization is unclear, report back instead of guessing.

## Wait cheaply

Hold each wait in the foreground so you never go idle before acting on its
result:

- **Claude Code (`ci-driver` subagent):** run each wait as a **foreground** Bash
  call with Bash `timeout: 600000` (10 minutes) and `--timeout 9m` on the
  command (`timeout 540 gh pr checks <PR> --watch` outside the monorepo).
  **Never** pass `run_in_background` inside a subagent, and **never** end a turn
  while CI is still pending — ending your turn terminates the subagent without
  reading or acting on the result. When a slice exits `6` (`timeout`) because CI
  is still running, immediately start the next 9-minute foreground slice (up to
  12 slices / ~108 minutes overall budget) before escalating a timeout. (Only
  the parent chat uses `run_in_background` for its backstop wait.)
- **Codex:** run it inside one `exec` cell whose first line is
  `// @exec: {"yield_time_ms": 3600000}`. Start it with
  `tools.exec_command({cmd, yield_time_ms: 30000})`. While the result has a
  `session_id` and no exit code, loop
  `tools.write_stdin({session_id, chars: "", yield_time_ms: 300000})`. Then
  `text()` the final output. If the cell yields before finishing, call `wait`
  on it with `yield_time_ms` 3600000. Never use the `sleep` tool or status
  loops.

The blocking command depends on the repository:

| Repository                | Wait (Claude 9m slice / Codex)                | Wait, then merge                              |
| ------------------------- | --------------------------------------------- | --------------------------------------------- |
| `shepherdjerred/monorepo` | `toolkit ci wait <PR> --timeout 9m --json`    | `toolkit pr land <PR> --timeout 9m --json`    |
| Other GitHub repositories | `timeout 540 gh pr checks <PR> --watch`       | the repo's own merge flow                     |

In Codex, `--timeout 9m` may be omitted because a single `exec` cell holds up to
an hour. In the monorepo, load `monorepo-delivery` and follow it for fixes,
pushes, and review findings. `packages/toolkit/README.md` defines the exit codes.

## Loop

1. Wait in the foreground. Use `pr land` only when merging is authorized. If a
   9-minute slice exits `6` (`timeout`) while the pipeline is still running and
   fewer than 12 slices have run on the current head, immediately run the next
   foreground slice without ending your turn.
2. Parse the JSON output from stdout AND inspect
   `toolkit pr review list <PR> --json` before acting or reporting:
   - **Ready (0) or merged (0):** verify no unresolved P0–P2 review threads
     remain in `toolkit pr review list <PR> --json`, then stop and report.
   - **CI failure, review-gate failure, or conflict (1):** read the JSON
     report's diagnostics, `toolkit pr review list <PR> --json`, and
     `toolkit ci explain <PR>` if they are not enough. Fix in-scope causes,
     address and resolve review threads with audited reasons per
     `monorepo-delivery`, run focused local checks, commit, and push through
     `toolkit git-spice`. Then reset your slice count and wait again on the new
     head.
   - **Head changed (4)** by your own push: wait again. Changed by someone
     else: stop and report.
   - **Human action (3), main red (5), overall budget exhausted on timeout (6),
     closed (7), merge failed (8):** stop and report. Never try to fix main.
3. Stop and report after two fix attempts that leave the same failure, and on
   infrastructure failures such as killed pipelines or runner loss. Do not
   blindly restart pipelines. The main chat or the user decides how to
   escalate.

Never skip a test, weaken a gate, or suppress an error to get green. Keep
unrelated worktree changes intact and stage explicit paths.

## Report

End with this, and nothing else the main chat must dig for:

```text
Outcome: green | merged | blocked | escalated
PR: <url> @ <head SHA>
Pipeline: <url and final status>
Fixes: <one line per commit pushed, or "none">
Blocker: <what stopped you, with the command or log that shows it>
Not verified: <deployment, runtime, or anything else not checked>
```
