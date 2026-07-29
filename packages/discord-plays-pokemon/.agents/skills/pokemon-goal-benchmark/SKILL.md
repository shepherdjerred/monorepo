---
name: pokemon-goal-benchmark
description: Run and interpret the real-model Pokémon Emerald goal benchmark. Use when measuring goal-agent reliability, comparing baseline and candidate runs, diagnosing benchmark artifacts, or deciding whether a run is a valid game failure versus invalid provider or harness evidence.
---

# Pokémon Goal Benchmark

Measure general gameplay with the strict catch evaluator. Do not turn the
benchmark into a scripted solver or count model prose as success.

## Prepare a clean measurement

1. Select the exact implementation commit and prepare a clean detached
   worktree or clone. Install the root toolchain and workspace dependencies and
   run generation before measuring:

   ```bash
   mise install
   bun install --frozen-lockfile
   bunx turbo run generate
   ```

2. Copy the source Emerald save outside the target checkout. Require exactly
   131,072 bytes; remove a trailing 16-byte RTC block from the copy, not the
   live save. Require a decodable active slot and at least one empty party slot
   so a catch creates independent party-identity evidence. Treat this source
   copy as immutable.
3. Build or obtain the target's `pokeemerald.wasm`. From the package root,
   `bun scripts/build-wasm.ts` writes
   `packages/backend/assets/pokeemerald.wasm`. Confirm that it belongs to the
   implementation being measured: the harness hashes the external file but
   records its relationship to `wasm-src/upstream.json` as `not-verified`.
4. Choose a new output path outside the target checkout. The harness refuses
   an existing output directory and requires both the benchmark runner and
   target implementation worktrees to be clean.

## Run

From `packages/discord-plays-pokemon/packages/backend` in the clean candidate:

```bash
bun run benchmark:goal \
  --save /absolute/path/to/copied-emerald.sav \
  --wasm ./assets/pokeemerald.wasm \
  --output /absolute/path/to/artifacts/candidate-<commit> \
  --runs 3 \
  --goal "get me a pokeman"
```

Use `--implementation-root /path/to/clean/copy` when the harness runner and
target are separate. It accepts either the monorepo root or
`packages/discord-plays-pokemon`. The target must be clean and fully set up.
For comparable repeated trials, keep the immutable source save, goal, model,
reasoning, runtime, and target WASM fixed. Each run receives a fresh
harness-owned save copy and a distinct control port.

Run `bun run benchmark:goal --help` for model, reasoning, runtime, port, Codex
binary, and boot-timeout options.

## Read the evidence

Read the printed `summary.json` first. It is written only after the run series:

- `completedRuns`, `validRuns`, `successfulRuns`, `failedRuns`, and
  `invalidRuns` show the measurement population.
- `successRate` uses valid runs only. Never include provider or harness failures
  in its denominator.
- `stoppedEarly` plus `stopReason: external-provider-failure` means a provider
  failure stopped the remaining requested runs.
- `allSucceeded` is true only when every requested run completed successfully.

Then inspect each `run-NNN/result.json`:

- `outcome` is the authoritative classification.
- For `success` or `game-failure`, inspect `evaluation.evidence`,
  `evaluation.failures`, and `evaluation.verifiedCaughtSpecies`. Success
  requires one exact caught species to correlate across a post-start event,
  post-event state, final live state, and a complete save persisted after the
  catch.
- For `invalid-provider`, inspect `providerFailure` and
  `provider-failure.json`. This is external provider evidence, not gameplay
  evidence; `evaluation` is null.
- For `harness-error`, inspect `error`, lifecycle fields, and worker logs.
  Treat the run as invalid and rerun only after fixing the cause.
- Use `telemetry` for turns, controls, repeated-position loops, ignored inputs,
  screenshots, knowledge queries, tokens, and cost. Use `provenance` to compare
  source-save, WASM, target, runner, evaluator, and Codex identities.

Preserve `input.flash`, `persisted.flash`, `codex.jsonl`, screenshots, worker
logs, and any provider-failure files. Do not claim success from the last Codex
message, process exit, screenshots, or a catch event alone.

## Interpret exit status

- `0`: every requested run passed the strict evaluator.
- `1`: at least one valid run was a `game-failure`, with no invalid run.
- `2`: at least one `invalid-provider` or `harness-error`, or command
  arguments/preflight failed. Preflight failures may occur before
  `summary.json` exists.

Count only `success` and `game-failure` as valid model measurements. Repeat
invalid runs after resolving provider or harness faults; do not relabel them as
game failures.
