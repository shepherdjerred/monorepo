# Auto-build pokeemerald.wasm from source (with customizations) in Dagger

## Status

Complete — shipped in PR #1333.

## Context

The Temporal schedule `pokeemerald-wasm-weekly` opens PRs titled
`chore(discord-plays-pokemon): update pokeemerald.wasm` (currently open: **PR #1256**) by
**downloading** a prebuilt wasm from `https://pokeemerald.com/build/wasm/pokeemerald.wasm` via
`scripts/fetch-wasm.ts`. That upstream is the **tripplyons** build — **audio stubbed out**, missing
the 4 game-state exports our reader needs. Our committed `pokeemerald.wasm` is instead the
**ottohg** build (`ottohg/pokeemerald-wasm@ee8b964`) made by `scripts/build-wasm.sh` (full C audio
engine `src/m4a_wasm.c` + a Makefile patch adding `gSaveBlock2Ptr`, `gPlayerParty`,
`gPlayerPartyCount`, `gBattleResults`). **Merging the Temporal PR regresses audio + game-state.**

**Fix:** build the wasm _from source with our patch_ in a Dagger image stage, using the repo's
existing idioms, and let **Renovate** advance the upstream pin. Retire the Temporal download
workflow/schedule; close PR #1256.

### The repo already has the exact pattern (use it)

- **`buildRedlibImageHelper`** (`.dagger/src/image.ts:1513`) builds an upstream project from source
  via the **native Dagger git layer** `dag.git(url).commit(SHA).tree()` — content-addressed, so the
  cache key is stable until the SHA changes (proper caching; **not** a `withExec git clone`, which
  caches the command string and never re-resolves).
- **Renovate `git-refs` custom manager** (`renovate.json:38-48` + annotation at
  `constants.ts:60`) auto-advances `REDLIB_SOURCE_REF` as upstream `main` moves → opens a bump PR.
  This is the idiomatic "if upstream updates we get that," **with review**, and it replaces the
  custom Temporal job entirely.
- **mario-kart patch series** (`packages/discord-plays-mario-kart/wasm-src/patches/NNNN-*.patch`,
  applied `patch -p1`, documented in `PATCHES.md`) is the repo's source-patch convention.
  (`bun patch`/`patchedDependencies` is npm-only — not applicable.)

### Decisions (confirmed with user)

- **Build approach:** Dagger image build from source (not Temporal-build-and-commit). No 14 MB blob
  in git; customizations can never be silently lost.
- **Patch handling:** checked-in `.patch` series (mario-kart model), not the brittle inline `sed`.
- **Upstream pickup:** pin a commit (reproducible) + Renovate `git-refs` auto-bump PR (redlib model).
  Live branch-tracking (`dag.git().branch("master")`) ships unreviewed wasm on every upstream push —
  rejected in favor of the reviewed Renovate flow.

### Pin facts (verified)

- ottohg default branch = **`master`**; current HEAD `c101be5ac2ae53c5d18ee063f16eeeda751639f8`.
- Full SHA of `ee8b964` = `ee8b9644375640fdb947b48a0d682adc35e0c297`.
- Keep the pin at **`ee8b964`** for v1 (matches the wasm we ship today → zero behavior change, just
  build-instead-of-vendor). Renovate then proposes the bump to `c101be5` as a separate reviewed PR.

## Phase 0 — PoC (validate the Linux build BEFORE buildout)

`build-wasm.sh` is macOS/homebrew; the one load-bearing unknown is whether the ottohg build works
in a Linux container. Validate with a throwaway Docker run (debian:bookworm-slim + clang/lld/llvm +
build-essential + libpng-dev + zlib1g-dev + python3 + uv), clone ottohg@pin, apply the export
delta, `make tools` + mapjson pre-gen + `make wasm`, then assert ~14 MB output and all exports
(`gWasmPcmL/R`, `gSoundInfo`, `gSaveBlock1/2Ptr`, `gPlayerParty[Count]`, `gBattleResults`,
`AgbMain`, `WasmRunFrame`). If clang-14 (bookworm) fails, retry `debian:trixie` (clang-19).

**Equivalence:** drop the PoC wasm over `assets/pokeemerald.wasm` and run, from
`packages/discord-plays-pokemon/packages/backend`:
`bun test src/emulator/emulator-symbols.integration.test.ts` and
`bun test src/emulator/audio/audio-fingerprint.test.ts`. Both green ⇒ container build is equivalent.

## Implementation

### 1. Checked-in patch series (mario-kart model)

- `packages/discord-plays-pokemon/wasm-src/patches/0001-extra-exports.patch` — the Makefile
  link-line delta adding the 4 `--export=` flags (replaces the inline `sed`).
- `packages/discord-plays-pokemon/wasm-src/PATCHES.md` — upstream repo, pinned SHA, what the patch
  does, refresh-on-bump steps (mirror mario-kart's "Updating upstream").
- `scripts/build-wasm.sh`: apply the patch instead of inline `sed`; drop the `.sha256` sidecar write
  (pin file gone); header note: CI builds the same wasm in Dagger; keep in sync on pin bumps.

### 2. Pin + Renovate (`.dagger/src/constants.ts` + `renovate.json`)

- Add, mirroring `REDLIB_SOURCE_REF`:
  `// renovate: datasource=git-refs depName=pokeemerald-source branch=master`
  `export const POKEEMERALD_SOURCE_REF = "ee8b9644375640fdb947b48a0d682adc35e0c297";`
- Add a `git-refs` custom manager in `renovate.json` cloned from the redlib block
  (datasourceTemplate `git-refs`, depNameTemplate `pokeemerald`, packageNameTemplate
  `https://github.com/ottohg/pokeemerald-wasm`).
- Add a pinned, Renovate-annotated `POKEEMERALD_WASM_TOOLCHAIN_IMAGE` (debian, per Phase 0).
  **Do not reuse `EMSCRIPTEN_IMAGE`** — frozen at emsdk 2.0.7, lacks libpng/zlib; this build uses
  clang `wasm32-unknown-unknown` + `wasm-ld`, not emcc.

### 3. Dagger build stage (`.dagger/src/image.ts`)

`buildPokeemeraldWasm(patchesDir: Directory): File`, cache-ordered least→most volatile:
`dag.git(OTTOHG_REPO).commit(POKEEMERALD_SOURCE_REF).tree()` → container from toolchain image →
apt install (mounted apt cache, stable volume name) → uv → `withDirectory("/src", src)` →
`withDirectory("/patches", patchesDir)` → apply patches → `make tools` → mapjson pre-gen →
`WASM_CC=clang WASM_LD=wasm-ld make wasm` → size guard → `.file(".../pokeemerald.wasm")`.
Wire into `buildDiscordPlaysPokemonImageHelper` with `.withFile(...assets/pokeemerald.wasm,
buildPokeemeraldWasm(pkgDir.directory("wasm-src/patches")))` after the pkg mount.

### 4. In-image verification gate

After wasm staged + `bun install`: `.withExec(["bun","test", emulator-symbols.integration.test.ts,
audio-fingerprint.test.ts])`. Gates the shipping artifact; a regressive upstream bump fails the
image build → the Renovate PR goes red.

### 5. Plain `bun run test` green without a committed wasm

Add `existsSync(assets/pokeemerald.wasm)` skip-guard to both tests (generalize the audio test's
`SKIP_AUDIO_FINGERPRINT` guard). Plain step self-skips; image build + local-after-build run the gate.

### 6. Cleanup — delete / edit

- `git rm`: `…/assets/pokeemerald.wasm`, `…/assets/pokeemerald.wasm.sha256`, `scripts/fetch-wasm.ts`,
  `packages/temporal/src/{workflows,activities}/pokeemerald-wasm.ts`.
- Temporal wiring: remove imports/re-exports in `workflows/index.ts` + `activities/index.ts`; delete
  the `pokeemerald-wasm-weekly` SCHEDULES entry and add it to `DELETED_SCHEDULE_IDS` (keep the
  existing `pokeemerald-wasm-monthly` delete entry); update `register-schedules.test.ts`; remove the
  deleted activity path from `scripts/check-suppressions.ts`.
- `discord-plays-pokemon/.gitignore`: drop the `!…/pokeemerald.wasm` negation; fix comment.
- `lefthook.yml`: remove the dead large-files allow for the committed wasm.
- `packages/backend/src/config/schema.ts`: comment → `build-wasm.sh` / Dagger build.
- Docs: `_summary.md` + `README.md` ("Temporal … refreshes the blob" → "built from source in CI");
  `packages/docs/architecture/2026-06-06_temporal-worker-and-scheduler.md`. Optional: fix
  `discord-plays-pokemon/README.md` (`tripplyons` → `ottohg`).

## Verification

1. Phase 0 passes (Linux build + both tests green against the container wasm).
2. `bun run typecheck` in `packages/temporal` + `packages/discord-plays-pokemon`.
3. `bun run test` at touched packages — plain step self-skips the two wasm tests.
4. Dagger image build builds the wasm + runs the in-image gate green.
5. `bunx eslint . --fix`; `bun scripts/check-suppressions.ts`, `bun scripts/check-todos.ts`,
   `bun scripts/check-dagger-hygiene.ts` clean; `renovate.json` parses.

## Operator actions (note in PR description)

- Close **PR #1256** and delete branch `auto/update-pokeemerald-wasm`.
- `pokeemerald-wasm-weekly` schedule removed automatically on next worker deploy via
  `DELETED_SCHEDULE_IDS` (belt-and-suspenders: pause/delete in the Temporal UI).
- After merge, expect a Renovate PR bumping `POKEEMERALD_SOURCE_REF` `ee8b964` → `c101be5`; review it
  through the in-image gate.

## Fast-follow (optional, separate PR)

Fork `ottohg/pokeemerald-wasm` into `shepherdjerred/`, commit the 4 exports upstream, point
`OTTOHG_REPO` at the fork → the patch disappears and the build is a plain `make wasm`.

## Session Log — 2026-06-27

### Done

- **Phase 0 validated the load-bearing assumption first.** `debian:bookworm-slim` (clang-14)
  compiled the wasm but it **failed to load in Bun** (`function index exceeds function index
space` — stale lld-14; the committed blob was built with homebrew clang-22).
  `debian:trixie-slim` (clang-19) produced a Bun-loadable, ~14 MB wasm with all exports.
- **Dagger build (`.dagger/src/image.ts`)** — added `buildPokeemeraldWasm(patchesDir)`:
  `dag.git(ottohg).commit(POKEEMERALD_SOURCE_REF).tree()` (content-addressed, redlib pattern) →
  trixie toolchain (apt cache, layers ahead of source) → apply patch → `make tools` + mapjson
  pre-gen → `WASM_CC=clang WASM_LD=wasm-ld make wasm` → size guard → `.file()`. Wired into
  `buildDiscordPlaysPokemonImageHelper` via `.withFile(...)` after the pkg mount (wasm-src excluded
  from the runtime image), plus an in-image gate running the symbol + audio-fingerprint tests.
- **Pin + Renovate** — `POKEEMERALD_SOURCE_REF` + `POKEEMERALD_WASM_TOOLCHAIN_IMAGE` in
  `constants.ts`; a `git-refs` custom manager in `renovate.json` (cloned from redlib). Regex made
  tolerant of prettier's line-wrap (the longer identifier wraps past 80 cols) and **tested** to
  match (`master` / `ee8b96…`).
- **Patch series** — `wasm-src/patches/0001-extra-exports.patch` (+ `PATCHES.md`), generated from
  the pinned Makefile and verified to apply with `patch -p1`. `build-wasm.sh` now applies the patch
  (not the inline sed), uses the full pinned SHA, and drops the `.sha256` sidecar.
- **Test skip-guards** — both wasm tests skip via `Bun.file(WASM_PATH).size` (no `node:fs`, which
  the bun-runtime lint rule bans) when the wasm is absent; they run for real in the image build.
- **Cleanup** — `git rm` of the 14 MB blob, its `.sha256`, `fetch-wasm.ts`, and the Temporal
  workflow+activity; removed Temporal index wiring; `pokeemerald-wasm-weekly` added to
  `DELETED_SCHEDULE_IDS`; updated `register-schedules.test.ts`, `check-suppressions.ts`,
  `.gitignore`, `lefthook.yml`, `schema.ts`, `config.example.toml`, README/\_summary/architecture
  doc.
- **Verification** — temporal `bun test` 591 pass / 0 fail (incl. workflow-bundle smoke);
  temporal + dpp typecheck clean; dpp wasm tests skip cleanly with no wasm; eslint + prettier +
  check-suppressions + check-todos + check-dagger-hygiene clean; `.dagger` tsc clean (only a local
  `@types/node` env gap). **End-to-end: `dagger call` built the wasm through the real Dagger path
  (14,063,093 B), and both gate tests pass against that Dagger-produced artifact.**

### Remaining (operator / follow-up)

- Open the PR; in its description note: close **PR #1256** + delete branch
  `auto/update-pokeemerald-wasm`. The `pokeemerald-wasm-weekly` schedule is removed automatically on
  the next worker deploy via `DELETED_SCHEDULE_IDS`.
- After merge, expect a Renovate PR bumping `POKEEMERALD_SOURCE_REF` `ee8b964` → `c101be5` (ottohg
  has moved); review it through the in-image gate.
- Optional fast-follow: fork ottohg into `shepherdjerred/` and commit the exports upstream so the
  patch disappears.

### Caveats

- The from-source wasm is **not byte-reproducible** across toolchain versions (it differs slightly
  from the old committed blob). This is fine — it's rebuilt per image and gated behaviorally by the
  audio fingerprint + symbol tests, not by a hash. The `.sha256` pin machinery is intentionally gone.
- Toolchain image is pinned to **trixie, not bookworm** — bookworm's clang-14 links a wasm Bun
  rejects. Don't "simplify" to bookworm.
- `packages/discord-plays-mario-kart/scripts/fetch-wasm.ts` is a stale copy-paste still mentioning
  pokeemerald — out of scope here; worth a separate cleanup.
- The in-image gate adds ~20 s (two real tests) to every pokemon image build; intentional — it gates
  the shipping artifact and turns a regressive Renovate bump red.
