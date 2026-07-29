# discord-plays-pokemon — agent notes

Headless Pokémon Emerald (pokeemerald-wasm, ottohg fork with the C m4a audio engine) running in Bun, streamed to a Discord voice channel via `@shepherdjerred/discord-video-stream`. See `README.md` for the architecture; this file is the agent quick-reference. The WASM is built from source by `scripts/build-wasm.ts` (invoked during the Docker image build; CI builds + smokes + pushes the image via `.buildkite/pipeline.yml`) — never committed; Renovate advances the commit in `wasm-src/upstream.json`. See `wasm-src/PATCHES.md`.

The tracing/metrics wiring, loopback audio transport, Go-Live streamer base class, web server, and bot entrypoint are shared with discord-plays-mario-kart in **`@shepherdjerred/discord-plays-core`** (`packages/discord-plays-core`, source-only, subpath imports) — see its `AGENTS.md`. This backend supplies the Pokémon-specific pieces: the emulator, `PokemonGameDriver`, the goal system, `copyMs` + game-event/notification metrics, the socket dispatch, and the llm-observability span-processor wrap passed to `bootGameBot`.

## Generated data (species/map tables)

`packages/backend/src/game/events/generated/species.ts` and
`packages/backend/src/game/spatial/generated/map-names.ts` are committed
generator output — never hand-edit. `scripts/generate-species-data.ts` and
`scripts/generate-map-names.ts` fetch from `ottohg/pokeemerald-wasm` at the
`commit` pin in `wasm-src/upstream.json` (single source of truth, read via
`scripts/lib/pokeemerald-pin.ts`; Renovate advances the pin plus the
Dockerfile's `ENV` copy). Freshness:

- `build-wasm.ts` re-runs both generators after every wasm build, so a manual
  wasm refresh can't leave the tables stale.
- The `dpp-pokeemerald-data-daily` Temporal schedule (04:30 PT,
  `packages/temporal/src/activities/dpp-pokeemerald-data-refresh.ts`)
  regenerates against the current pin and opens a PR on drift — the follow-up
  to a merged Renovate pin bump (hosted Renovate can't run the generators in
  its own PR).

## Goal-agent benchmark

`packages/backend` exposes the operator-only `benchmark:goal` command for
repeatable real-model catch measurements. Run it from a clean, fully set-up
checkout of the implementation being measured. Keep the source save and output
directory outside that checkout: both the runner and target implementation
fail preflight when their Git worktrees are dirty, and every output path must
be new.

The required inputs are:

- `--save`: an immutable, exactly 131,072-byte Pokémon Emerald flash save.
  Remove any 16-byte RTC trailer from a copied save; never point the benchmark
  at the live save. The active save slot must decode successfully and the party
  must have an empty slot so a catch produces independent party-identity
  evidence.
- `--wasm`: the built `pokeemerald.wasm` for the implementation under test.
  `bun scripts/build-wasm.ts` writes
  `packages/backend/assets/pokeemerald.wasm`. The harness records the file's
  SHA-256 and the target's configured upstream pin, but does not prove that the
  external file was built from that pin.
- `--output`: a nonexistent artifact directory. Existing results are never
  overwritten.

From `packages/discord-plays-pokemon/packages/backend`:

```bash
bun run benchmark:goal \
  --save /absolute/path/to/copied-emerald.sav \
  --wasm ./assets/pokeemerald.wasm \
  --output /absolute/path/to/artifacts/candidate-<commit> \
  --runs 3 \
  --goal "get me a pokeman"
```

Each run starts from a fresh harness-owned copy of the same source save. Use
`--implementation-root /path/to/clean/copy` when the harness runner and target
implementation are different checkouts; both a monorepo root and this package
root are accepted. Record the exact goal, model, reasoning, runtime, source-save
hash, WASM hash, target commit, and runner commit when comparing results. See
the dynamically loaded `pokemon-goal-benchmark` skill for the complete
clean-copy and artifact-reading workflow.

The command prints `summary.json` after writing it last. Interpret
`summary.json` first, then each `run-NNN/result.json`:

- `success` is valid only when the strict evaluator correlates a post-start
  catch event to the same new species in post-event state, final live state,
  and the persisted 128 KiB save written after the catch.
- `game-failure` is a valid measurement that did not satisfy that evaluator.
  Read `evaluation.failures`; do not infer success from Codex prose, a
  screenshot, or process exit alone.
- `invalid-provider` is quota, authentication, startup, or turn failure from
  the model provider. `evaluation` is null, the series stops early, and the run
  must not count as a gameplay failure.
- `harness-error` is an invalid measurement caused by boot, worker, persistence,
  artifact, or other harness failure. Fix the cause and rerun.

Exit `0` means every requested run succeeded; `1` means one or more valid runs
failed the game evaluator; `2` means an invalid provider measurement, harness
error, invalid argument, or preflight failure. `summary.json.successRate`
excludes invalid runs from its denominator.

## Goal agent knowledge corpus

`knowledge/generated/records.json` and
`knowledge/cc-by-nc-sa-2.5/walkthrough.json` are committed generator output.
Never hand-edit them. `scripts/generate-knowledge.ts` validates
`knowledge/sources.json`, fetches only pinned upstream revisions, validates the
normalized records, sorts them deterministically, and fails if Bulbapedia's
current revisions have drifted from the manifest.

- Archipelago supplies the MIT-licensed Emerald region graph.
- PokeAPI supplies BSD-3-Clause Generation III species, move, and item data.
- Bulbapedia supplies the separately stored full walkthrough under CC
  BY-NC-SA 2.5; preserve `knowledge/cc-by-nc-sa-2.5/NOTICE.md` and per-record
  attribution.
- Runtime access is bounded through `pokemonctl knowledge search` and
  `pokemonctl knowledge get`; do not embed the corpus in the base prompt.
- `.agents/skills/pokemon-{world,progression,species,items,battle}` are focused
  discovery instructions, not copies of the underlying facts.

After updating a source pin, run `bun run generate:knowledge`, then verify the
scripts and backend packages. The Temporal data refresh also regenerates this
corpus and treats any drift as a reviewable change.

## Reading live game state from the wasm

The notifier polls emulator memory (~2×/s) for faints/badges/evolutions/catches. Read-side modules: `packages/backend/src/emulator/{memory,symbols}.ts`, `src/game/events/`; debug with `packages/backend/scripts/probe-memory.ts`.

- Goal-mode decisions use the versioned C observation ABI in
  `wasm-src/patches/0001-extra-exports.patch` and
  `packages/backend/src/emulator/engine-observation.ts`. Keep the packed C
  struct, exported byte size, decoder offsets, and the mandatory Docker
  `wasm-abi-test` stage in sync. Do not reconstruct volatile phase, map,
  collision, or battle-controller state from guessed TypeScript offsets.
- Semantic goal input is serialized by `GameController`, and `GoalManager`
  holds the emulator's exclusive `goal` input lease for the full process
  lifecycle. New input paths must identify their input source; no Discord/web
  command may interleave while the lease is held. Terminal paths must claim an
  active goal synchronously before awaiting so timeout, replacement, shutdown,
  and process exit cannot release twice.
- `pokemonctl navigate` is a bounded current-map movement helper, not a story
  solver. It must re-read collision and nearby objects, replan when a tile is
  blocked, and stop on map/phase/readiness changes.
- The wasm exports **every C global as a `WebAssembly.Global`** (name section present) — resolve addresses by symbol via `instance.exports.<name>.value`, never hard-code. Key symbols: `gSaveBlock1Ptr`, `gSaveBlock2Ptr`, `gPlayerParty`, `gPlayerPartyCount`, `gBattleResults`.
- The **data segment lives in LOW linear memory (~0x5e_0000–0x63_0000), NOT at GBA EWRAM 0x02000000.** Only hardware-mapped regions (REG 0x04.., VRAM 0x06.., FLASH 0x0e..) are at GBA addresses — pointer-validity checks must allow low addresses.
- `gSaveBlock1Ptr`/`gSaveBlock2Ptr` are pointers the game **relocates periodically** (anti-cheat) — dereference fresh every poll, never cache the target.
- Party = 6 × 100-byte struct; species is in an XOR-"encrypted", checksum-gated substruct (key = personality^OTID, order = personality%24). The wasm32 ABI uses `sizeof(SaveBlock1) == 0x3c40`, `SaveBlock1.flags` @0x1248, `sizeof(SaveBlock2) == 0xf08`, and `SaveBlock2.encryptionKey` @0xa8; the commonly documented retail/GBA `flags` offset 0x1270 is not the live wasm layout. `SaveBlock2.pokedex` is @0x18 (owned @+0x10, 52 B, bit index = nationalDexNum−1), and `BattleResults.caughtMonSpecies` is @0x28.
- **At the title screen SaveBlock1 + `gPlayerParty` are loaded but SaveBlock2 is zeroed until you pick "Continue"** — `pokedex.owned` reads all-zero pre-Continue. Cross-check dex offsets against `SaveBlock1.seen1` @0x988 (a 52-B copy loaded at the title screen). To test offline, point the probe `--save` at a 128 KiB Emerald `.sav` (truncate any 16 trailing RTC bytes to exactly 131072).

## ESLint / test-file config (`packages/backend`)

Test files (`*.test.ts`) are **excluded from tsconfig** (tsc with `types:["bun"]` can't see bun's test globals) — leave the exclude; un-excluding breaks tsc on `describe`/`test`/`expect`. Consequence: every test file must be listed in `eslint.config.ts` under `projectService.allowDefaultProject`. typescript-eslint caps that at 8 files; raise it with `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING` (set to 20) — a key that required widening the shared `projectService` type in `packages/eslint-config/src/configs/base.ts` (consumed from the gitignored `dist`, so `bun run build` eslint-config after editing). Put large generated source in a `generated/` dir to dodge `max-lines` (base.ts ignores `**/generated/**`).
