---
title: Scout Explore replay
description: What a replay run reads, what it writes, and what it cannot reproduce.
sidebar:
  order: 7
---

The Explore replay harness runs the real Explore agent against a frozen copy of
a stage's data and records every turn. It is a manual gate, never CI: each case
is a live model call.

Source: [`src/explore/replay/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol/packages/backend/src/explore/replay) and
[`scripts/explore-replay/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol/packages/backend/scripts/explore-replay).

## Commands

| Command                                  | Does                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `dev:lake-pull --stage <beta\|prod>`     | Copies that stage's published report-lake build                   |
| `dev:db-pull --stage <beta\|prod>`       | Restores that stage's Postgres into `scout_<stage>_snapshot`      |
| `explore:capture-guilds --stage <stage>` | Records each target guild's capabilities, writes the dataset pin  |
| `explore:curate-corpus --stage <stage>`  | Lists replayable conversations; `--write <path>` emits the corpus |
| `test:explore:replay`                    | Runs cases and writes a bundle                                    |
| `explore:summarize <bundle>`             | Prints condition rollups, signal counts and worst cases           |

## Dataset pin

`$XDG_DATA_HOME/scout-for-lol/stage-dataset/<stage>/dataset.json`, mode `0600`.

| Field                                        | Meaning                                                                                                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lake.buildId`, `lake.puuidRemapFingerprint` | The published build this dataset reads                                                                                                                                                                                        |
| `database.name`, `database.url`              | The restored snapshot                                                                                                                                                                                                         |
| `accountRows`                                | Parquet and database account counts                                                                                                                                                                                           |
| `database.snapshotId`                        | Hash of the rows a replay never writes; survives restoring the same dump ([source](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/scripts/explore-replay/snapshot-identity.ts)) |
| `database.writableRows`                      | Per-table hash of what a replay can write ([source](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/scripts/explore-replay/writable-rows.ts))                                    |
| `flagSource`                                 | `provider` when Flipt was consulted, else `static`                                                                                                                                                                            |
| `guilds`                                     | Per-guild captured capabilities and requester                                                                                                                                                                                 |

A run refuses to start unless `DATABASE_URL` names the pinned database on
loopback and on the pinned port, `REPORT_LAKE_DIR` resolves to the pinned lake,
`FEATURE_FLAGS_MODE` is `disabled` or `static`, `TEMPORAL_ADDRESS` is unset,
and `ENVIRONMENT` is unset or `dev`
([`dataset.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/replay/dataset.ts)).

`ENVIRONMENT` is the harness's to set, not the caller's. A prod dataset must
resolve flags as prod, because `isFeatureHardDisabled` and the beta-only
override stripping fire only there. The same variable also makes configuration
demand a complete PostHog setup outside dev, which a replay never uses. So the
run loads configuration under `dev`, then sets `ENVIRONMENT=prod` for a prod
pin; only flag resolution reads it live. A caller who sets it first is refused
([`stage-flag-semantics.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/scripts/explore-replay/stage-flag-semantics.ts),
[`flags.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/configuration/flags.ts)).

## Bundle

`$XDG_STATE_HOME/scout-for-lol/explore-replay/<runId>/`, directory `0700`,
files `0600`. Both are checked before the first model call.

| Path                  | Contents                                                                           |
| --------------------- | ---------------------------------------------------------------------------------- |
| `manifest.json`       | Dataset pin, guild, model, corpus and prompt hashes, flag overrides, token budgets |
| `cases.jsonl`         | One line per completed case; the `--resume` index                                  |
| `cases/<caseId>.json` | Prompt as the model received it, candidate, trace, diff, signals                   |
| `summary.json`        | Case count, integrity failures, `passed`                                           |

`passed` means harness integrity only: every case ran and the configuration was
what it claimed. It is not a statement about answer quality. A resumed run
counts the cases it skipped, so a clean remainder cannot certify a run whose
earlier half failed ([`bundle.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/replay/bundle.ts)).

Signals stored in a case record are those computed at run time.
`explore:summarize` re-derives them with the current grader, so a grading change
applies to bundles already written.

That holds while the recorded capability set is one the current code
understands. Adding a capability ends it: the older bundle never resolved the
new one, so `explore:summarize` refuses it rather than inventing a value, and
the sweep has to be re-run.

## Case kinds

| Kind              | Case id                      | Baseline                                 |
| ----------------- | ---------------------------- | ---------------------------------------- |
| Chip              | `chip:<sha of prompt>`       | An earlier run, via `--baseline <runId>` |
| Conversation turn | `conv:<conversation>:<turn>` | The answer that turn originally produced |

Chips never shipped an answer, so the first sweep of a guild establishes their
baseline rather than comparing to one
([`chips.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/replay/chips.ts)).

A chip id is a hash of its prompt, so it is the same in every bundle. A
`--baseline` from another stage, guild or capability set is refused rather than
compared, and guilds are compared by id: `prod-top-1` is a rank label that can
name a different guild in a later pin. A conversation case id survives
re-curation, so the corpus hash must match too.

## Signals

| Signal                      | Fires when                                                 |
| --------------------------- | ---------------------------------------------------------- |
| `new_turn_errored`          | The turn threw                                             |
| `new_turn_timed_out`        | The turn was aborted on time                               |
| `new_answer_empty`          | It finished and said nothing                               |
| `new_query_failed`          | A query failed and no later query ran                      |
| `rows_zero_was_nonzero`     | The baseline found rows and this run found none            |
| `refusal_regression`        | The baseline answered with substance; this run declined    |
| `numeric_claim_dropped`     | A figure the baseline asserted is absent                   |
| `capability_mismatch`       | The turn did not resolve the capabilities the pin captured |
| `gated_chip_did_not_refuse` | The feature is off and the answer never said so            |
| `ungated_chip_refused`      | The feature is on and the answer declined                  |

Signals are triage aids. `capability_mismatch`,
`gated_chip_did_not_refuse` and `ungated_chip_refused` are assertions about the
configuration; the rest rank cases for reading
([`signals.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/replay/signals.ts)).

A gated chip satisfies its expectation by declining. A clarifying question
raises the signal too; see the limits below.

## Guild recovery

A turn's capabilities come from its guild, so a replay establishes one or
refuses the case.

| Source           | Basis                                                     |
| ---------------- | --------------------------------------------------------- |
| `message-column` | `ExploreMessage.guildIds`, recorded by the turn           |
| `run-payload`    | The durable run whose `resultMessageId` is that answer    |
| `beta-allowlist` | Beta admits exactly one guild, so a beta turn ran with it |

There is no fourth source. A turn with no establishable guild is left out of the
corpus ([`plan.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/replay/plan.ts)).

## Limits

- On-demand Riot reads are never reproduced. The tool starts a Temporal
  workflow and would write new matches into the snapshot mid-run.
- Creation resolves only to tier 1. Tier 2 needs a live Discord OAuth token,
  and `dev:db-pull` redacts those at source.
- Only the published lake build is copied, never staging NDJSON, so a dataset
  excludes roughly the newest fifteen minutes of matches.
- A bundle holds real conversation text and stays local; the committed corpus
  holds identifiers only.
- Dare, challenge and creation tools persist drafts and confirmation intents,
  and nothing rolls them back between cases. A run refuses a snapshot whose
  writable tables have moved since the pin, so restore it between sweeps;
  within one sweep, an earlier case can still affect a later one. Restoring the
  same dump reproduces both identities, so a baseline stays comparable.
- A gated chip satisfies its expectation only by declining. Asking the person
  what they meant raises `gated_chip_did_not_refuse` too: separating a
  clarifying question from a drafted dare shaped like one needs to understand
  the text, so those rows are known noise rather than a wrong verdict.
- `explore:capture-guilds` reads static flag configuration unless
  `FEATURE_FLAGS_MODE=flipt` points it at the stage's provider. `flagSource`
  records which, because a static capture is not evidence of live targeting.
- Every case runs on the `web` surface. Curation admits a turn only when its
  own durable run records that surface. The conversation's `origin` cannot
  prove it: the migration that added the column defaults every earlier row to
  `legacy`, and a pre-migration Discord thread continued on the web later would
  carry web runs for its newer turns only
  ([`curate-corpus.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/scripts/explore-replay/curate-corpus.ts)).

## Related

- [Replay Explore against a stage](/how-to/replay-explore-against-a-stage/)
- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
