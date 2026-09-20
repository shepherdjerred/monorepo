---
title: Scout Explore replay
description: What a replay run reads, what it writes, and what it cannot reproduce.
sidebar:
  order: 7
---

The Explore replay harness runs the real Explore agent against a frozen copy of
a stage's data and records every turn. It is a manual gate, never CI: each case
is a live model call.

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

| Field                                        | Meaning                                       |
| -------------------------------------------- | --------------------------------------------- |
| `lake.buildId`, `lake.puuidRemapFingerprint` | The published build this dataset reads        |
| `database.name`, `database.url`              | The restored snapshot                         |
| `accountRows`                                | Parquet and database account counts           |
| `guilds`                                     | Per-guild captured capabilities and requester |

A run refuses to start unless `DATABASE_URL` names the pinned database on
loopback, `REPORT_LAKE_DIR` resolves to the pinned lake, `FEATURE_FLAGS_MODE`
is `disabled` or `static`, `TEMPORAL_ADDRESS` is unset, and `ENVIRONMENT` is
unset or `dev`.

`ENVIRONMENT` is the harness's to set, not the caller's. A prod dataset must
resolve flags as prod, because `isFeatureHardDisabled` and the beta-only
override stripping fire only there. The same variable also makes configuration
demand a complete PostHog setup outside dev, which a replay never uses. So the
run loads configuration under `dev`, then sets `ENVIRONMENT=prod` for a prod
pin; only flag resolution reads it live. A caller who sets it first is
refused.

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
what it claimed. It is not a statement about answer quality.

Signals stored in a case record are those computed at run time.
`explore:summarize` re-derives them with the current grader, so a grading change
applies to bundles already written.

## Case kinds

| Kind              | Case id                      | Baseline                                 |
| ----------------- | ---------------------------- | ---------------------------------------- |
| Chip              | `chip:<sha of prompt>`       | An earlier run, via `--baseline <runId>` |
| Conversation turn | `conv:<conversation>:<turn>` | The answer that turn originally produced |

Chips never shipped an answer, so the first sweep of a guild establishes their
baseline rather than comparing to one.

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
configuration; the rest rank cases for reading.

## Guild recovery

A turn's capabilities come from its guild, so a replay establishes one or
refuses the case.

| Source           | Basis                                                     |
| ---------------- | --------------------------------------------------------- |
| `message-column` | `ExploreMessage.guildIds`, recorded by the turn           |
| `run-payload`    | The durable run whose `resultMessageId` is that answer    |
| `beta-allowlist` | Beta admits exactly one guild, so a beta turn ran with it |

There is no fourth source. A turn with no establishable guild is left out of the
corpus.

## Limits

- On-demand Riot reads are never reproduced. The tool starts a Temporal
  workflow and would write new matches into the snapshot mid-run.
- Creation resolves only to tier 1. Tier 2 needs a live Discord OAuth token,
  and `dev:db-pull` redacts those at source.
- Only the published lake build is copied, never staging NDJSON, so a dataset
  excludes roughly the newest fifteen minutes of matches.
- A bundle holds real conversation text and stays local; the committed corpus
  holds identifiers only.

## Related

- [Replay Explore against a stage](/how-to/replay-explore-against-a-stage/)
- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
