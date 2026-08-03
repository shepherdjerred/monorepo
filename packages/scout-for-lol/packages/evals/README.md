# Scout Review Evals

Calibration app for immutable post-match review datasets. It stores raw
source artifacts, processed match context, exact prompts, model settings,
generations, human ratings, and style-batch freshness ratings in SQLite.

## Run The App

```bash
bun run --filter=@scout-for-lol/evals dev
```

The API binds to `127.0.0.1:7341`; Vite binds to `127.0.0.1:7342`.
`SCOUT_EVAL_DATABASE_PATH` overrides the default database under `data/`.

The production server (`bun run start`) binds loopback by default; `--host` or
`SCOUT_EVAL_HOSTNAME` widens the bind. The app has no auth, so any non-loopback
bind must sit behind a real trust boundary — the hosted instance runs on the
homelab behind a tailnet-only Tailscale ingress at
`https://scout-evals.<tailnet>.ts.net`, where the tailnet is the auth layer.
Never expose it publicly (no Funnel).

## Discover Candidates

First sync the sanitized tracked-player profile snapshot from Beta SQLite. The
command queries only `Player` and `Account` through a read-only connection; it
does not copy tokens, audit data, or the 4 GB live database.

```bash
bun run --filter=@scout-for-lol/evals sync-beta
```

Then use a narrow date prefix. Discovery reads only the `scout-beta` S3 corpus
and emits tracked Beta participants with their alias, KDA, classifier reason,
and suggested performance slice.

```bash
AWS_PROFILE=seaweedfs bun run --filter=@scout-for-lol/evals discover -- \
  --prefix games/2026/07/28/ --limit 100
```

The suggested slice is only a starting point. The final explicit
match-player-style case list requires human approval. A derived sibling
`timelineKey` is included; verify it when an upload may have crossed a UTC date
boundary.

## Materialize A Draft

Create a JSON spec with explicit cases and either new `dataset` metadata or the
`datasetId` shown by an existing draft in the app. These targets are mutually
exclusive. Each case requires
`matchKey`, `timelineKey`, the synced Beta `targetPlayerId`,
`targetPlayerPuuid`, `performanceSlice`, `styleKey` (`aaron` or `nekoryan`),
and frozen selected behaviors. Optional
`playerHistory` and `patchContext` default to empty strings. The source bucket
is fixed to `scout-beta`; tracked profiles are resolved from the synced Beta
corpus snapshot rather than accepted from the spec.

```bash
AWS_PROFILE=seaweedfs OPENAI_API_KEY=... \
  bun run --filter=@scout-for-lol/evals materialize -- \
  --spec ./calibration-20.json
```

The command prepares every case before writing the dataset. It downloads and
hashes exact S3 bodies, validates Riot schemas, builds explicit tracked-player
matches, runs the text-only review pipeline, freezes summaries and prompts, and
records one baseline generation. Existing targets must still be drafts; invalid
or finalized IDs fail before model calls. It leaves the dataset as a draft.
Inspect the case list in the app and use **Finalize dataset** only after
approving membership; finalization permanently locks case artifacts.

Raw S3 objects do not identify Scout aliases or tracked-player membership. The
sanitized Beta snapshot supplies that mapping and materialization fails if the
target is absent. API keys remain server-side and are never included in the
Vite bundle.

## Push A Draft To The Hosted Instance

Materialization stays local (it needs `OPENAI_API_KEY`, AWS credentials, and
the Beta corpus snapshot), but rating happens on the hosted app. Move a
locally-materialized draft over the tailnet with:

```bash
bun run --filter=@scout-for-lol/evals dataset:push -- \
  --dataset <dataset-id> \
  --server https://scout-evals.<tailnet>.ts.net
```

`SCOUT_EVAL_REMOTE_URL` supplies the server when `--server` is omitted;
`--database` / `SCOUT_EVAL_DATABASE_PATH` select the local source database.

Draft transfers carry dataset metadata, frozen case artifacts, and generations
— never human or freshness ratings, which are authored on the receiving
instance. Pushes are additive merges: re-pushing after extending the draft
(`materialize` with the spec's `datasetId`) inserts only the missing cases and
generations, verifies existing records are byte-identical (canonical-JSON), and
rejects any drift, checksum mismatch, or finalized target instead of
overwriting. A push that adds a generation to a style invalidates that style's
freshness rating on the server, exactly like recording a generation locally.
Ratings authored on the server always survive re-pushes.

## Transfer A Finalized Dataset

Export a finalized dataset to the versioned, checksummed JSON interchange
format:

```bash
bun run --filter=@scout-for-lol/evals dataset:export -- \
  --dataset <dataset-id> \
  --output ./calibration-export.json
```

Import that file into another eval database:

```bash
bun run --filter=@scout-for-lol/evals dataset:import -- \
  --input ./calibration-export.json \
  --database ./imported-evals.sqlite
```

Exports preserve the dataset ID and version, ordered immutable cases, every
generation and human rating, and style freshness ratings. Import validates the
strict schema and SHA-256 checksum before opening a transaction. It rejects
dataset ID, dataset key/version, case ID, and generation ID collisions; it
never overwrites records or silently assigns a different version. Export also
refuses to overwrite an existing output file.

## Browser Tests

The Playwright suite runs the production-built client against the real
Hono/tRPC/SQLite stack with deterministic, in-memory fixtures. It does not read
the local eval database or call Beta, S3, or OpenAI.

```bash
bunx turbo run test:e2e --filter=@scout-for-lol/evals
```

The suite covers draft creation, finalization, individual ratings, browser
history and deep links, freshness ratings, persistence, invalid route ownership,
and narrow mobile layouts. Chromium runs single-worker because the scenarios
mutate dedicated datasets in one in-memory store.

## Session Log — 2026-07-29

### Done

- Preserved cross-guild Beta identities and required materialization to select
  an explicit Beta player.
- Updated candidate discovery, package scripts, documentation, and regression
  coverage.
- Allowed materialization specs to target the `datasetId` created by the app,
  with fail-fast draft validation and atomic persistence into that same record.
- Added strict, checksummed dataset export/import through store, tRPC, and CLI
  surfaces with deterministic round trips and explicit ID and version collision
  failures.

### Remaining

- Resolve the PR's Buildkite pipeline conflict and remaining P2 review findings.
- Validate the published head in Buildkite and current-head review.

### Caveats

- Existing materialization specs must add `targetPlayerId` from candidate
  discovery.
- Existing version 1 Beta corpus snapshots must be regenerated with
  `bun run --filter=@scout-for-lol/evals sync-beta`.
- A materialization spec must provide exactly one of `dataset` or `datasetId`;
  an existing target must be a draft.
- Dataset imports preserve IDs and versions exactly, so operators must resolve
  collisions rather than expecting overwrite or automatic renumbering.
