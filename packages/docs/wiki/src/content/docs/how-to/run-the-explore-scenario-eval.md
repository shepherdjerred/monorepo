---
title: Run the Explore scenario eval
description: Seed Scout's use-case scenarios into throwaway guilds, run them on web, Discord and voice, and read which ones fail.
sidebar:
  order: 14
---

The scenario eval runs real prod use cases against Explore in seeded guilds and grades each answer.
Use it before and after an Explore change, and put both summaries in the PR.

Each case in
`packages/scout-for-lol/packages/data/src/model/reports/explore-scenario-corpus.json`
seeds an asker, a server, its players, reports and earlier confirmation cards.
It then runs on every surface the case lists. Deterministic checks and a
`gpt-5.6-terra` rubric judge decide each turn. A full run is about 40 live
conversations and a few dollars.

## 1. Pull a lake

The fixtures point at real accounts in a pulled report-lake build.
The eval copies the build and never writes to it.

```bash
bun run --filter='./packages/scout-for-lol' dev:lake-pull -- --stage prod
```

The build must match the current lake schema. A stale pull fails on its first query.

## 2. Run it

```bash
cd packages/scout-for-lol
../../scripts/onepassword/with-service-account.sh \
  op run --env-file=./dev-web.env.tpl -- \
  env -u OP_SERVICE_ACCOUNT_TOKEN -u ENVIRONMENT -u DATABASE_URL \
  LLM_HOURLY_TOKEN_BUDGET=200000000 LLM_DAILY_TOKEN_BUDGET=500000000 \
  bun run --filter=@scout-for-lol/backend test:explore:scenarios -- \
    --concurrency 4 --write
```

The eval sets `ENVIRONMENT`, `DATABASE_URL` and `REPORT_LAKE_DIR` itself and refuses to start if they are already set.
Set `SCOUT_PG_PORT` when the shared dev Postgres runs on a non-default port.

| Option                         | Use it to                                      |
| ------------------------------ | ---------------------------------------------- |
| `--only <id,id>`               | Run selected cases while iterating             |
| `--surfaces web,discord,voice` | Limit the surfaces                             |
| `--no-judge`                   | Smoke-test the harness; checks only, no score  |
| `--write`                      | Update the committed summary report            |
| `--source-lake <dir>`          | Copy a lake other than the pulled prod dataset |
| `--model <id>`                 | Run a model other than prod's                  |

## 3. Read the result

Stdout and
`packages/scout-for-lol/packages/backend/src/explore/explore-scenario-eval-report.json`
hold verdicts only.
The evidence goes to a private bundle under
`~/.local/state/scout-for-lol/explore-scenarios/runs/<timestamp>/`, one file per
case and surface. Each file holds the seeded world, every answer, the tool trace,
each check, and each judge reason.

:::caution[A failing control voids the run]
Cases marked `control` should pass before any fix. If one fails, the harness
or a fixture is wrong, and the other verdicts are not evidence.
:::

Check every failing case in its bundle before acting on it. Each fixture
names real prod accounts, so the bundle stays local and out of the PR.

## Related

- [Replay Explore against a stage](/how-to/replay-explore-against-a-stage/) —
  replays real conversations rather than seeded scenarios
- [Scout Explore replay reference](/reference/scout-explore-replay/)
