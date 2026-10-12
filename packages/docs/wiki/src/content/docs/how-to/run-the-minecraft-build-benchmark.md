---
title: Run the Minecraft build benchmark
description: Rate the builds the agent harness produces against fixed anchors with a vision judge, and keep the leaderboard moving when the harness changes.
sidebar:
  order: 40
---

The build bench answers one question: did a change to the Minecraft harness
(skills, DSL, renderer, lint) make the builds agents produce better? It rates
promoted builds from eval runs with a vision judge
([`judge.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/mc-harness/src/build/judge.ts)) and keeps the
history in the repository under
[`packages/mc-harness/evals/bench/history/`](https://github.com/shepherdjerred/monorepo/blob/84b657a3b60121069875424642aac5ed73d3da1f/packages/mc-harness/evals/bench/history).

## Before you start

- Docker, an authenticated agent CLI (`codex` or `claude`) and model spend:
  the eval runner is manual and never runs in CI.
- `OPENAI_API_KEY` (or the key for the `--model` you pass) for the judge.
- One checkout per harness version you want to rate: the runner evaluates
  `HEAD`, so commit first.

## 1. Run the tasks

```bash
bun packages/mc-harness/evals/run.ts --agent codex --tasks e2,e5,b1,b2,b3,m1,m2,m3,m4 --parallel 2
```

Run the same tasks twice (two agents, or the same agent twice) the first time
you rate a head, so the noise band is known. The run id is printed and the
report lands under `~/.toolkit/mc/evals/<runId>/`
([`run.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/mc-harness/evals/run.ts)). The fixed task set is
[`bench/tasks.ts`](https://github.com/shepherdjerred/monorepo/blob/84b657a3b60121069875424642aac5ed73d3da1f/packages/mc-harness/evals/bench/tasks.ts).

## 2. Collect

```bash
bun packages/mc-harness/evals/bench/bench.ts collect --run <runId>
```

For every build task the run graded, this renders the promoted site's judge
sheet, lints it, hashes it, measures repetition on placements and excavations since the
captured site, and writes an entry under
`evals/bench/history/<task>/<head>-<agent>-<runId>/`
([`collect.ts`](https://github.com/shepherdjerred/monorepo/blob/84b657a3b60121069875424642aac5ed73d3da1f/packages/mc-harness/evals/bench/lib/collect.ts)). No
model is called.

## 3. Judge

```bash
bun packages/mc-harness/evals/bench/bench.ts judge --task m1
bun packages/mc-harness/evals/bench/bench.ts judge --task e2 --model <id>
```

Each task's entries, plus the anchors for that rubric, play a round-robin of
order-swapped pairwise comparisons
([`tournament.ts`](https://github.com/shepherdjerred/monorepo/blob/84b657a3b60121069875424642aac5ed73d3da1f/packages/mc-harness/evals/bench/lib/tournament.ts)).
Verdicts are cached by sheet hash in `pair-cache.json`, so a new entry costs
only its own pairs. Entries without an absolute score for that model are
scored 0–5 per axis, aesthetics last
([`judge.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/mc-harness/src/build/judge.ts)). Ratings are
Bradley–Terry on an Elo-like scale, centred so the anchors average 1000
([`bradley-terry.ts`](https://github.com/shepherdjerred/monorepo/blob/84b657a3b60121069875424642aac5ed73d3da1f/packages/mc-harness/evals/bench/lib/bradley-terry.ts)).

## 4. Report and commit

```bash
bun packages/mc-harness/evals/bench/bench.ts report
git add packages/mc-harness/evals/bench/history
```

`LEADERBOARD.md` and `index.json` are regenerated from the history
([`leaderboard.ts`](https://github.com/shepherdjerred/monorepo/blob/84b657a3b60121069875424642aac5ed73d3da1f/packages/mc-harness/evals/bench/lib/leaderboard.ts)).
Each tournament records the hash of every sheet it judged and the
fingerprint of the pair prompt and rubric it judged under, and each score
the hash of the sheet it scored; the report shows "sheet changed, re-judge"
or "judge changed, re-judge" instead of a number for an entry whose
`sheet.jpg` or judging policy changed since. Adding or removing anchors also
invalidates every rating; absolute scores of unchanged sheets remain valid.
Attach the leaderboard diff to the PR that changed the harness.

## Reading a round

- Anchors should beat the agents with non-overlapping intervals. If they do
  not, the judge is not separating quality: try another model and look at a
  few pairs yourself before trusting a trend.
- Most order-swapped comparisons should agree. When the forward and reversed
  judgments disagree, the verdict becomes a tie (`agreed: false` in the
  tournament file). A tie in both orders is an agreed tie. Many disagreement
  ties mean the judge is order-sensitive; many agreed ties mean it finds the
  pairs genuinely alike.
- Two runs of the same head should land inside each other's interval; a
  harness change has helped when the new head's rating sits above the old
  head's upper bound.

## Anchors

Anchors are fixed builds the agents never see, one set per rubric
([`bench/anchors/`](https://github.com/shepherdjerred/monorepo/blob/84b657a3b60121069875424642aac5ed73d3da1f/packages/mc-harness/evals/bench/anchors)): the micro
rubric has two library buildings, the map rubric has the `house` component
demo as a hamlet. All three are flagged `weak` in their `meta.json`; relative
movement is still valid, but "reaches the anchor" means little until
professional builds are added:

```bash
bun packages/mc-harness/evals/bench/bench.ts anchor <slug> <file.schem> --rubric micro --source "<where it came from>" --licence "<licence>"
```

Record the source and licence; only builds whose licence allows local use
belong here, and the schematic stays out of the repository.

## Related

- [Operate The Storm with the agent harness](/how-to/operate-the-storm-with-the-agent-harness/)
- Bench internals and file layout: [mc-harness evals README](https://github.com/shepherdjerred/monorepo/blob/main/packages/mc-harness/evals/README.md#bench)
- Judge sheet and render modes: [mc-build README](https://github.com/shepherdjerred/monorepo/blob/main/packages/mc-build/README.md#renderer-assets)
