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

Each wait is one blocking command, held so that it costs no turns:

- **Claude Code:** run it with `run_in_background` and act on the completion
  notification. Do not read the output file, sleep, or poll meanwhile.
- **Codex:** run it inside one `exec` cell whose first line is
  `// @exec: {"yield_time_ms": 3600000}`. Start it with
  `tools.exec_command({cmd, yield_time_ms: 30000})`. While the result has a
  `session_id` and no exit code, loop
  `tools.write_stdin({session_id, chars: "", yield_time_ms: 300000})`. Then
  `text()` the final output. If the cell yields before finishing, call `wait`
  on it with `yield_time_ms` 3600000. Never use the `sleep` tool or status
  loops.

The blocking command depends on the repository:

| Repository                | Wait                          | Wait, then merge              |
| ------------------------- | ----------------------------- | ----------------------------- |
| `shepherdjerred/monorepo` | `toolkit ci wait <PR> --json` | `toolkit pr land <PR> --json` |
| Other GitHub repositories | `gh pr checks <PR> --watch`   | the repo's own merge flow     |

In the monorepo, load `monorepo-delivery` and follow it for fixes, pushes and
review findings. `packages/toolkit/README.md` defines the exit codes.

## Loop

1. Wait. Use `pr land` only when merging is authorized.
2. Act on the result:
   - **Ready (0) or merged (0):** stop and report.
   - **CI failure or conflict (1):** read the report's diagnostics, and
     `toolkit ci explain <PR>` if they are not enough. Fix the cause within
     the PR's scope, run focused local checks, commit, and push through the
     repository's flow (`toolkit git-spice` in the monorepo). Then wait again
     on the new head.
   - **Review findings:** address them, then resolve each thread with an
     audited reason, as the delivery skill describes.
   - **Head changed (4)** by your own push: wait again. Changed by someone
     else: stop and report.
   - **Human action (3), main red (5), timeout (6), closed (7), merge failed
     (8):** stop and report. Never try to fix main.
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
