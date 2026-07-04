# Pokémon graphics corruption — missing libc imports in bios.ts

## Status

Complete

## Symptom

Discord Plays Pokémon graphics broke in production some time after the June 27
deploy of PR #1333 (build `pokeemerald.wasm` from source in Dagger instead of
vendoring a blob). Goal-bot screenshots from 2026-07-03 on the pod show the
intro with blacked-out tiles and missing sprites, then stuck all-white /
all-gray frames. Screenshots from 2026-06-15 (pre-#1333 image) were normal.

## Diagnosis

1. Built the wasm locally from the same pinned source
   (`POKEEMERALD_SOURCE_REF` = `ee8b964`, same patch series) via
   `scripts/build-wasm.sh` and ran it with `scripts/probe-memory.ts` — intro
   rendered perfectly. So renderer/emulator/upstream source were all fine.
2. Pulled the shipped wasm out of the running pod (`kubectl cp`) and ran it
   through the identical local harness — it reproduced the corruption exactly.
   The Dagger-built artifact itself was the problem.
3. Compared the two binaries section-by-section (custom Python wasm section
   parser): data segments differed by only 95 B of 10.7 MB (not an asset
   conversion issue), but the prod binary's import section had four extra
   entries: `env.memcpy`, `env.memmove`, `env.memset`, `env.memcmp`.

**Root cause:** the Dagger toolchain (debian trixie, clang-19) lowers C
`memcpy`/`memset`/etc. to calls to external libc symbols, which become wasm
imports (`wasm32-unknown-unknown` has no libc). Homebrew LLVM 22 (local) and
ottohg's own builds instead emit inline bulk-memory ops (visible in the
`target_features` custom section), so those imports never existed before.
`bios.ts` `dispatch()` had `default: return 0` — a faithful port of upstream
`web/app.js` `importsFor()` — so in production **every memory copy in the game
was a silent no-op**: graphics buffers never populated (black tiles, missing
sprites, blank fades) while the game logic limped along well enough that the
in-image gate tests (symbols + audio fingerprint) still passed.

## Fix

`packages/discord-plays-pokemon/packages/backend/src/emulator/bios.ts`:

- Implement `memcpy`/`memmove` (`u8.copyWithin`, returns dst), `memset`
  (`u8.fill` with u8 truncation, returns dst), `memcmp` (byte-wise diff).
- Fail fast: `imports()` now validates every function import against
  `IMPLEMENTED_IMPORTS` ∪ `NOOP_IMPORTS` (link-cable/multiboot/reset stubs that
  upstream also no-ops) and **throws at instantiation** for anything unknown.
  Future toolchain drift now fails the in-image Dagger gate (which boots the
  emulator) at build time instead of shipping corrupted graphics.

Tests: `src/emulator/bios.test.ts` hand-encodes minimal wasm modules with
chosen `env.*` imports, exercises the four libc implementations through the
real `imports()` wiring, and asserts unknown imports throw. Registered in
`eslint.config.ts` `allowDefaultProject` per package convention.

## Verification

- `bun test` (198 pass, includes integration tests booted against the actual
  broken prod wasm copied into `assets/`), `bunx tsc --noEmit`, eslint clean.
- End-to-end: ran the exact binary extracted from the prod pod under the fixed
  bios — intro renders correctly (screenshots in PR).

## Notes

- Upstream ottohg `web/app.js` has the same latent `default: return 0`; it
  only works because their toolchain never emits libc imports. Worth an
  upstream report at some point.
- The worktree setup gap: `scripts/setup.ts` installs deps before
  `@shepherdjerred/llm-models` is built, so the bun-store copy in
  discord-plays-pokemon lacks `dist/` and backend typecheck fails until you
  `bun run build` in `packages/llm-models` and re-`bun install` in the pokemon
  package.

## Session Log — 2026-07-03

### Done

- Diagnosed prod graphics corruption end-to-end (screenshots from pod PVC,
  wasm binary diff, local reproduction with the shipped artifact).
- Fixed `bios.ts` (libc mem\* imports + fail-fast unknown-import validation),
  added `bios.test.ts`, registered it in `eslint.config.ts`.
- Verified: full backend suite green against the broken prod wasm; prod wasm
  renders correctly under the fixed bios.

### Remaining

- Merge the PR; the next image build ships the fix. No emulator-side redeploy
  caveats — the broken binary itself renders fine once the host implements the
  imports.

### Caveats

- `saves/goal-screenshots` (old path) vs `saves/<guildId>/goal-screenshots`
  (current) both exist on the PVC; the old one is stale (June 15).
- `scripts/build-wasm.sh` only exports `CPATH`/`LIBRARY_PATH` for `make wasm`,
  not the earlier `make tools`, so a machine without pkg-config needs
  `CPATH=/opt/homebrew/include LIBRARY_PATH=/opt/homebrew/lib` prefixed to the
  whole script (hit this; worked around rather than changed the script in this
  PR).

## Follow-up — 2026-07-04 (PR review)

Greptile flagged a P2 on the import validator: it checked `item.name` but not
`item.module`, so a wasm importing a same-named function from another namespace
(e.g. `wasi_snapshot_preview1.memcpy`) could pass validation yet still fail to
instantiate. Added an `item.module !== "env"` guard before the name check that
throws an actionable error naming the unexpected namespace, plus a test
(`imports from a non-env namespace fail fast, even for known names`). Commit
`136064da0`.

## Workflow Friction

- Fresh-worktree `bun run scripts/setup.ts` leaves
  `@shepherdjerred/llm-models` unbuilt, breaking discord-plays-pokemon backend
  typecheck (`src/goal/pricing.ts` import). Fix: add llm-models to setup's
  Shared Builds phase (before per-package installs copy it into the bun
  store), or re-install after building. Files: `scripts/setup.ts`,
  `packages/llm-models`.
