---
title: Replay Explore against a stage
description: Copy a stage's data, run the shipped chips and real conversations through the live agent, and read what came back.
sidebar:
  order: 13
---

Replaying shows how Explore answers today against the data a stage actually
holds. Use it to establish a baseline before changing Explore, and to compare
against that baseline afterwards.

Every case is a live model call. A full chip sweep is a few dollars and around
twenty minutes.

## 1. Copy the stage's data

Pull the lake first. Its accounts are derived from Postgres, so a database
captured afterwards is a superset of the identities the lake references; the
other order can leave lake rows pointing at accounts the snapshot lacks.

```bash
bun run --filter='./packages/scout-for-lol' dev:lake-pull -- --stage beta
bun run --filter='./packages/scout-for-lol' dev:db-pull  -- --stage beta
```

Beta is around 260 MB and prod around 900 MB. Each table is verified against
the pod's file count, and a transfer that truncates is retried.

:::caution[Prod carries real player data]
`--stage prod` puts real aliases, Discord IDs and PUUIDs on your machine.
Credentials are redacted at source; the identifiers are not.
:::

## 2. Record what the guilds can do

```bash
bun run --filter=@scout-for-lol/backend explore:capture-guilds -- --stage beta
```

This writes the dataset pin, including each target guild's real capabilities.
Beta resolves the one allowlisted guild; prod takes the guilds with the most
Explore usage that are not yours.

Check the summary it prints. If a guild shows fewer features than you expect,
the snapshot or the flag registry disagrees with your assumption — fix that
before spending on a sweep.

## 3. Run it

The harness needs secrets for the model, and must be aimed at the pin:

```bash
LAKE="$HOME/.local/share/scout-for-lol/stage-dataset/beta/report-lake"
cd packages/scout-for-lol
op run --env-file=./dev-web.env.tpl -- env \
  DATABASE_URL="postgres://scout@127.0.0.1:5471/scout_beta_snapshot" \
  REPORT_LAKE_DIR="$LAKE" \
  FEATURE_FLAGS_MODE=disabled \
  LLM_HOURLY_TOKEN_BUDGET=200000000 \
  LLM_DAILY_TOKEN_BUDGET=500000000 \
  bun run --filter=@scout-for-lol/backend test:explore:replay -- \
    --chips --concurrency 4
```

Raise the token budgets deliberately. The in-process ceiling defaults to 2M an
hour, which a sweep passes, and hitting it aborts the run part-way.

For prod, point the three paths at the prod pin and add `--stage prod`. Do not
set `ENVIRONMENT`: the run applies the pinned stage's flag semantics itself,
and setting it yourself makes configuration demand stage secrets the replay
never uses.

Start with `--limit 3 --concurrency 1` the first time; it costs pennies and
proves the wiring. Add `--conversations` to replay the curated corpus, and
`--baseline <runId>` to compare against an earlier run.

If a run is interrupted, `--resume <runId>` continues it and skips what already
finished.

## 4. Read the result

```bash
bun run --filter=@scout-for-lol/backend explore:summarize -- \
  ~/.local/state/scout-for-lol/explore-replay/<runId> --worst 12
```

Read the per-condition violations first: those are chips contradicting what
their guild can do. Then open the worst cases by hand. The
[reference](/reference/scout-explore-replay/) describes every field and signal.

## Curating conversations

```bash
bun run --filter=@scout-for-lol/backend explore:curate-corpus -- \
  --stage beta --min-turns 2
```

That prints candidates with their text, because choosing which are worth
replaying means reading them. Add `--write
packages/scout-for-lol/packages/backend/src/explore/replay/corpus.beta.json`
once you have chosen; the committed file carries identifiers only.

## Related

- [Scout Explore replay reference](/reference/scout-explore-replay/)
- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
