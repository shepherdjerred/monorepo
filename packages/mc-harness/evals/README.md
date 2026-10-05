# Minecraft harness evals

Task suite that hands a coding agent (Codex or Claude Code) a Minecraft job,
lets it work only through `toolkit mc` and the harness skills, then grades
what it left in its sandbox. Use it to measure the harness and the skills
before and after a change. It is manual: it needs Docker, an authenticated
agent CLI and real model spend, so it never runs in CI. The graders' unit
tests (`evals/test/`) do run with the package tests.

```bash
bun packages/mc-harness/evals/run.ts --agent codex --tasks e1,e4
bun packages/mc-harness/evals/run.ts --agent codex --tasks all --parallel 3
bun packages/mc-harness/evals/run.ts --agent claude --tasks e2,e5
```

Options: `--model <id>` (default: the agent's configured model), `--tasks`
(`all` or `e1,e3`), `--parallel <n>` (default 2), `--keep` (leave worktrees,
homes, sandboxes and daemons for debugging).

## What a run does

1. Builds `MCBridge.jar` once in the current checkout.
2. Per task: a detached `git worktree` of `HEAD` (uncommitted changes are not
   evaluated), `bun install --frozen-lockfile`, the bridge jar copied in, and
   an isolated `HOME` so parallel tasks never share a daemon, sandboxes,
   journals or playtest runs. `HOME/bin/toolkit` runs that worktree's toolkit
   with the absolute `bun` binary; the Paper and renderer caches are cloned from
   your real `HOME`; Docker keeps your real client config.
3. Runs the agent non-interactively with the shared preamble
   (`tasks/_preamble.md`) plus the task, an `OUT` directory, and a timeout.
   Codex reads its login from `~/.codex`; Claude Code reads its login through
   `CLAUDE_CONFIG_DIR` pointed at your real `~/.claude`. The runner never reads
   or forwards provider credentials.
4. Grades through the task's daemon socket (never the CLI's argument parsing),
   then removes the task's sandboxes, daemon, worktree and `HOME` unless
   `--keep`.
5. Writes `~/.toolkit/mc/evals/<runId>/report.md` and `report.json`; each task
   directory keeps `prompt.md`, `events.jsonl` (the agent's JSONL stream),
   `last.md`, `out/` and grader artifacts.

## Tasks and graders

| Task | Asks the agent to                                                     | Grader passes when                                                                                                                        |
| ---- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| e1   | Build an exact hollow radius-4 tower with door, window, crenellations | The region matches a real `//hcyl` ring cell for cell, openings are right, crenellations alternate, nothing stray                         |
| e2   | Run the build pipeline end to end for a cottage on a site it prepares | `build verify` reports 0 mismatches, `build lint` reports 0 errors, the grader renders the promoted site                                  |
| e3   | Write a lever/lamp playtest and make it pass                          | The scenario passes on a fresh sandbox and three mutants (no lamp, no use, no break) all fail                                             |
| e4   | Answer a furnace/hopper timing question by experiment                 | Claimed numbers are right (2–3 ingots in the chest, 5 raw iron, top hopper → input) and the frozen world at the reported positions agrees |
| e5   | Build a two-story hip-roofed house with a chimney on a sculpted slope | Same as e2                                                                                                                                |
| e6   | Repeat e1 entirely in negative x/z                                    | Same as e1, shifted (regression for negative-coordinate parsing)                                                                          |
| m1   | Natural request: an impressive ~80×80 castle town on a hill           | Same as e2                                                                                                                                |
| m2   | Natural request: an impressive ~96×96 harbor island                   | Same as e2                                                                                                                                |

`e*` tasks use the guided preamble (`tasks/_preamble.md`), which names the
skills and steps. `m*` tasks use `tasks/_preamble-natural.md`: a plain user
request with only the environment rules and deliverables, so they also measure
whether the agent discovers the repository guidance on its own.

Looks are not auto-graded: e2/e5 artifacts include the grader's own render
of the promoted site and the agent's `final.png`; judge them against the
building skill's rubric.

## Cost and time

Round 1 with Codex `gpt-6-luna` (high reasoning): e1 ≈ 7 min / 1.3M input
tokens (mostly cached), e2 ≈ 7 min / 1.4M, e3 ≈ 4 min / 0.6M, e4 ≈ 4 min /
0.6M. Grading adds 1–2 minutes per task (e3 boots its own sandbox). Map tasks (m1, m2) with
Codex `gpt-6-luna`: 22–26 min and 3–5M input tokens (mostly cached) each.
