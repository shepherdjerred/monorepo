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
| b1   | Natural request: a two-storey tavern with a furnished interior        | Same as e2, plus delivered checks (≥12×9, ≥12 tall, furniture, fences)                                                                    |
| b2   | Natural request: a stone chapel with a 20-block bell tower            | Same as e2, plus delivered checks (≥11×18, ≥20 tall, path, trees, fences)                                                                 |
| b3   | Natural request: a lighthouse on a rocky cove with water              | Same as e2, plus delivered checks (≥20×20, ≥22 tall, water, path, fences)                                                                 |
| m1   | Natural request: an impressive ~80×80 castle town on a hill           | Same as e2                                                                                                                                |
| m2   | Natural request: an impressive ~96×96 harbor island                   | Same as e2                                                                                                                                |
| m3   | Natural request: a ~50×50, ~60-tall mountain temple                   | Same as e2                                                                                                                                |
| m4   | Natural request: a ~160×160 river valley village                      | Same as e2                                                                                                                                |
| m5   | Natural request: a ~250×250 walled port city                          | Same as e2                                                                                                                                |
| m6   | Natural request: a ~500×500×50 region map                             | Same as e2                                                                                                                                |

`e*` tasks use the guided preamble (`tasks/_preamble.md`), which names the
skills and steps. `m*` tasks use `tasks/_preamble-natural.md`: a plain user
request with only the environment rules and deliverables, so they also measure
whether the agent discovers the repository guidance on its own.

Build tasks also check what was delivered (`evals/grade/delivered.ts`):
built footprint, height and block count from edits against the captured site
(placements and excavations; untouched terrain is excluded), required
features from surviving placements (door, window, roof stairs, lights, furniture, path, trees, water,
fences), a lint warning ceiling (one for a building, two for a scene or map,
whose site box can trip the whole-box facade and monotone rules on its
terrain edge) and a repetition ceiling, so a map task cannot pass with a
cottage or with flat, unlit boxes.
The grader renders the promoted site's contact sheet, hero and **judge
sheet** (`promoted-judge.png`); looks are rated by the bench below, never by
pass/fail. Process is graded from the build's own journal
(`evals/grade/trajectory.ts`): the build must keep a `journal.jsonl`, show
at least two critiqued iterations with distinct grid hashes, and never accept a candidate that was
not critiqued or whose critique total is below the last accepted one. The journal and the judge
records (`judge/*.json`) are copied into the task directory. Cross-build judge
images use content-addressed paths under `judge/inputs/`, separate from copied
source filenames, and remain portable through benchmark archives. The report
prints the trajectory (iterations, critique totals in order, accepted and
rejected candidates).

Before counting current-capture critique entries or publishing their totals,
grading validates each referenced record against its journal identity and score
and requires a readable judge image within the build. Missing, mismatched or
escaped evidence fails the process check and produces no trajectory summary.
Current-capture accept/reject entries with a verdict file also require a valid
pair record on the same rubric. The recorded winner (or incumbent on a tie),
both candidate identities and both content-addressed image inputs must match;
missing verdicts or altered image bytes fail grading before outcomes are counted.

## Bench

The bench turns promoted builds into a leaderboard that moves when the
harness improves. Every build is rated by a vision judge from its judge sheet
(anonymised: a letter for a title, hero, plan, value and normal views, fixed
close-ups) in two separate ways: order-swapped **pairwise** comparisons
against every other entry for the task, fitted into Bradley–Terry ratings
(Elo-like, centred so the anchors average 1000), and an **absolute** rubric
score, 0–5 per axis with the aesthetic question asked last. Anchors are fixed
reference builds the agents never see; until professional schematics are
approved, the renders under `bench/anchors/` are the anchors (two library
buildings for the micro rubric, the `house` component demo as a hamlet for
the map rubric) and are flagged `weak`, so only movement between harness
versions is meaningful.

```bash
bun packages/mc-harness/evals/run.ts --agent codex --tasks e2,e5,b1,b2,b3,m1,m2,m3,m4
bun packages/mc-harness/evals/bench/bench.ts collect --run <runId>     # no model calls
bun packages/mc-harness/evals/bench/bench.ts judge --task m1 [--model id]
bun packages/mc-harness/evals/bench/bench.ts report                   # offline
bun packages/mc-harness/evals/bench/bench.ts anchor <slug> <file.schem> --rubric micro|map --source <text> --licence <text>
```

`collect` writes `bench/history/<task>/<head>-<agent>-<runId>/{meta.json,
sheet.jpg}` (lint, grid hash, repetition, checks, time, tokens and the
trajectory from the journal; the schematic itself goes to
`~/.toolkit/mc/bench/` with its sha recorded) and copies the task's
`journal.jsonl` and `judge/*.json` beside them. The leaderboard's `Iters`
column shows iterations and critique totals per entry.
`judge` runs the round-robin for one task, caching every verdict by the two
sheets' hashes in `pair-cache.json`, scores entries that have no
`scores.json` for that model, and writes `tournaments/<timestamp>.json`.
`report` regenerates `bench/history/LEADERBOARD.md` and `index.json`; a
rating or score is shown only for the sheet it was taken of and under the
current judging prompt and pair-aggregation policy, so an entry whose `sheet.jpg` was replaced
(re-collected, or an anchor regenerated) reads "sheet changed", and a
tournament judged under an earlier prompt reads "judge changed". Adding,
removing or reclassifying anchors invalidates every rating ("anchors changed"),
while independent absolute scores of unchanged sheets remain valid, until
`judge` runs again. Commit the history: it is
the record of what each harness version produced. The
fixed task set is in `bench/tasks.ts`; `m5` and `m6` are opt-in (`--all`).

A round is meaningful when the anchors and the agent builds have separated
confidence intervals, order-swap agreement is high, and two runs of the same
head land within each other's interval; if the judge cannot separate anchors
from baseline, try another `--model` and spot-check pairs by eye before
trusting any trend.

## Cost and time

Round 1 with Codex `gpt-6-luna` (high reasoning): e1 ≈ 7 min / 1.3M input
tokens (mostly cached), e2 ≈ 7 min / 1.4M, e3 ≈ 4 min / 0.6M, e4 ≈ 4 min /
0.6M. Grading adds 1–2 minutes per task (e3 boots its own sandbox). Map tasks (m1, m2) with
Codex `gpt-6-luna`: 22–26 min and 3–5M input tokens (mostly cached) each.
