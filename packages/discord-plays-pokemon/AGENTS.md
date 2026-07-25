# discord-plays-pokemon — agent notes

Headless Pokémon Emerald (pokeemerald-wasm, ottohg fork with the C m4a audio engine) running in Bun, streamed to a Discord voice channel via `@shepherdjerred/discord-video-stream`. See `README.md` for the architecture; this file is the agent quick-reference. The WASM is built from source by `scripts/build-wasm.sh` (invoked during the Docker image build; CI builds + smokes + pushes the image via `.buildkite/pipeline.yml`) — never committed; Renovate advances the `OTTOHG_SHA` pin in that script. See `wasm-src/PATCHES.md`.

The tracing/metrics wiring, loopback audio transport, Go-Live streamer base class, web server, and bot entrypoint are shared with discord-plays-mario-kart in **`@shepherdjerred/discord-plays-core`** (`packages/discord-plays-core`, source-only, subpath imports) — see its `AGENTS.md`. This backend supplies the Pokémon-specific pieces: the emulator, `PokemonGameDriver`, the goal system, `copyMs` + game-event/notification metrics, the socket dispatch, and the llm-observability span-processor wrap passed to `bootGameBot`.

## Generated data (species/map tables)

`packages/backend/src/game/events/generated/species.ts` and
`packages/backend/src/game/spatial/generated/map-names.ts` are committed
generator output — never hand-edit. `scripts/generate-species-data.ts` and
`scripts/generate-map-names.ts` fetch from `ottohg/pokeemerald-wasm` at the
`OTTOHG_SHA` pin in `scripts/build-wasm.sh` (single source of truth, read via
`scripts/lib/pokeemerald-pin.ts`; Renovate advances the pin plus the
Dockerfile's `ENV` copy). Freshness:

- `build-wasm.sh` re-runs both generators after every wasm build, so a manual
  wasm refresh can't leave the tables stale.
- The `dpp-pokeemerald-data-daily` Temporal schedule (04:30 PT,
  `packages/temporal/src/activities/dpp-pokeemerald-data-refresh.ts`)
  regenerates against the current pin and opens a PR on drift — the follow-up
  to a merged Renovate pin bump (hosted Renovate can't run the generators in
  its own PR).

## Reading live game state from the wasm

The notifier polls emulator memory (~2×/s) for faints/badges/evolutions/catches. Read-side modules: `packages/backend/src/emulator/{memory,symbols}.ts`, `src/game/events/`; debug with `packages/backend/scripts/probe-memory.ts`.

- The wasm exports **every C global as a `WebAssembly.Global`** (name section present) — resolve addresses by symbol via `instance.exports.<name>.value`, never hard-code. Key symbols: `gSaveBlock1Ptr`, `gSaveBlock2Ptr`, `gPlayerParty`, `gPlayerPartyCount`, `gBattleResults`.
- The **data segment lives in LOW linear memory (~0x5e_0000–0x63_0000), NOT at GBA EWRAM 0x02000000.** Only hardware-mapped regions (REG 0x04.., VRAM 0x06.., FLASH 0x0e..) are at GBA addresses — pointer-validity checks must allow low addresses.
- `gSaveBlock1Ptr`/`gSaveBlock2Ptr` are pointers the game **relocates periodically** (anti-cheat) — dereference fresh every poll, never cache the target.
- Party = 6 × 100-byte struct; species is in an XOR-"encrypted", checksum-gated substruct (key = personality^OTID, order = personality%24). Offsets: `SaveBlock1.flags` @0x1270 (badge flag ids 0x867–0x86E), `SaveBlock2.pokedex` @0x18 (owned @+0x10, 52 B, bit index = nationalDexNum−1), `BattleResults.caughtMonSpecies` @0x28.
- **At the title screen SaveBlock1 + `gPlayerParty` are loaded but SaveBlock2 is zeroed until you pick "Continue"** — `pokedex.owned` reads all-zero pre-Continue. Cross-check dex offsets against `SaveBlock1.seen1` @0x988 (a 52-B copy loaded at the title screen). To test offline, point the probe `--save` at a 128 KiB Emerald `.sav` (truncate any 16 trailing RTC bytes to exactly 131072).

## ESLint / test-file config (`packages/backend`)

Test files (`*.test.ts`) are **excluded from tsconfig** (tsc with `types:["bun"]` can't see bun's test globals) — leave the exclude; un-excluding breaks tsc on `describe`/`test`/`expect`. Consequence: every test file must be listed in `eslint.config.ts` under `projectService.allowDefaultProject`. typescript-eslint caps that at 8 files; raise it with `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING` (set to 20) — a key that required widening the shared `projectService` type in `packages/eslint-config/src/configs/base.ts` (consumed from the gitignored `dist`, so `bun run build` eslint-config after editing). Put large generated source in a `generated/` dir to dodge `max-lines` (base.ts ignores `**/generated/**`).
