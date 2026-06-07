# N64Wasm vendoring → pristine + patch-series

## Status

Complete

## Context

`packages/discord-plays-mario-kart/wasm-src/` vendors a patched fork of
[nbarkhina/N64Wasm](https://github.com/nbarkhina/N64Wasm) (parallel-n64 + angrylion
software RDP). It was a **hard fork**: upstream cloned, files edited in place, the
divergence described only in prose in `PATCHES.md`. Two problems:

1. **No update plan** and **no pinned baseline** — `PATCHES.md` said only "depth-1
   clone of master". The exact upstream commit was unrecorded, so the vendor was
   not reproducible.
2. Our changes were baked into the tree, so "what's ours vs theirs" was not
   mechanically recoverable.

User asked to (a) mark the vendored tree as vendored to git, (b) keep the source
"vanilla" with our changes clearly separated, and (c) define an update plan.
Decision (via AskUserQuestion): **patch-series model, in-repo (not a submodule)**,
with patches applied **at build time** and the committed `code/` tree kept
**byte-pristine**.

## What changed

### Baseline recovery (the missing pin)

Blobless clone of upstream + a git **blob-hash comparison** of every file proved
our tree is exactly upstream **master `bfac222f8a27287022844b47000328531834e9c1`**
minus two dead-code dirs. 690/692 files byte-identical; only `Makefile` and
`mymain.cpp` modified; **zero** files added.

### Files

- `wasm-src/code/` — **restored to byte-pristine** upstream@bfac222 (the 2 edited
  files reverted to upstream content). Verified: 0 modifications vs upstream.
- `wasm-src/patches/` (new) — our changes as a `git apply` series:
  - `0001-mymain-neil-host-exports.patch` — `neilSetRom` + ROM-from-memory `main()`,
    `neilGetVideoBuffer/Height`, `neil_send_mobile_controls_player`.
  - `0002-makefile-exported-functions.patch` — the 4 exports + `ASSERTIONS=1
--profiling-funcs`.
- `wasm-src/vendor-excludes.txt` (new) — the two Vulkan paraLLEl trees
  (`mupen64plus-{video,rsp}-paraLLEl`), dead code behind `HAVE_PARALLEL`, removed
  to stay under the repo's 5 MB per-file hook.
- `scripts/vendor-n64wasm.sh` (new) — the **update mechanism**: shallow single-commit
  fetch @ pinned SHA → apply excludes → refresh pristine `code/` → validate patch
  series still applies. Bump `UPSTREAM_SHA` + run = update.
- `scripts/build-wasm.sh` — restructured to stage pristine `code/` into a temp dir,
  **apply `patches/`**, then `make` (committed tree never mutated). Dropped the
  `2>/dev/null || true` cp guards (fail-fast).
- `.dagger/src/image.ts` — emscripten stage now applies `patches/*` via `git apply`
  (git is present in `emscripten/emsdk:2.0.7`) before `make clean && make`. Doc
  comment updated.
- `packages/discord-plays-mario-kart/.gitattributes` — `wasm-src/code/** linguist-vendored`
  (drops ~280k LoC of C/C++ from GitHub language stats; stays searchable/diffable; scoped
  to `code/` so our `patches/`/docs stay attributed to us) **+** `wasm-src/code/** text=auto
eol=lf` to override the repo-root `*.vcxproj eol=crlf` rule and stop CRLF churn on re-vendor.
- `wasm-src/PATCHES.md`, `README.md` — rewritten for the pristine + patch-series model,
  incl. the **bare-`make` footgun warning** (pristine tree compiles without our exports).

## Verification

- Patches are valid unified diffs; **round-trip** (apply to fresh pristine →
  `cmp` against our files) = byte-identical. ✅
- Tree is byte-pristine vs upstream@bfac222 (692/692 match, 0 modified). ✅
- **Dagger patch-apply** replicated in the real `emscripten/emsdk:2.0.7` image:
  both patches `git apply` cleanly; result contains all neil exports. ✅
- `shellcheck` clean; `bash -n` OK; `check-dagger-hygiene.ts` = no violations. ✅
- **Vendor-script idempotency:** re-vendor from upstream → normalized-hash diff vs
  the committed tree is **empty** (692/692 identical). The committed tree is exactly
  what the script reproduces. Excludes removed both paraLLEl trees; both patches
  re-validated. ✅
- **eol churn fixed:** the vendor `cp` wrote LF, tripping the repo-root `*.vcxproj
eol=crlf` rule on the inert `N64_Wasm.vcxproj`. Confirmed content-identical
  (`--ignore-cr-at-eol` empty, clean-filtered hash == HEAD blob) and resolved with the
  scoped `eol=lf` attribute. ✅
- Full `build-wasm.sh` emscripten compile: the rewritten script applied both patches
  and `make` began compiling; the **local** run is blocked by flaky-network failures
  fetching emscripten's SDL2 ports (`IncompleteRead`), not by the patches. Patch
  application is independently proven in the real image (above); CI's Dagger emscripten
  stage runs the authoritative build with reliable network.

## Caveats

- **Footgun (accepted):** because `code/` is pristine, a bare `make` in it yields an
  export-less wasm. Mitigated by loud warnings in `PATCHES.md`/`README.md` and by the
  fact that both supported build paths (`build-wasm.sh`, Dagger) apply patches.
- Upstream fetch is network-flaky here; the vendor script got a retry loop + shallow
  single-commit fetch. CI/Dagger does **not** fetch upstream (it builds the committed
  pristine tree), so this only affects manual re-vendoring.
- `EMSCRIPTEN_IMAGE` stays pinned at 2.0.7 (newer emsdk breaks the legacy SDL2/GLES2
  build) — unchanged.

## Session Log — 2026-06-07

### Done

- Recovered + pinned the upstream baseline `bfac222` (was unrecorded); restored
  `wasm-src/code/` to byte-pristine upstream (692/692).
- Extracted our changes into `wasm-src/patches/{0001,0002}` (round-trip byte-exact,
  apply cleanly in the real `emscripten/emsdk:2.0.7` image).
- Added `wasm-src/vendor-excludes.txt` + `scripts/vendor-n64wasm.sh` (update mechanism;
  ran end-to-end, idempotent).
- Rewired both build paths to apply patches at build (`scripts/build-wasm.sh`,
  `.dagger/src/image.ts`).
- `.gitattributes`: `linguist-vendored` + `eol=lf` scoped to `wasm-src/code/`.
- Rewrote `PATCHES.md` + `README.md`; this log.
- Verified: shellcheck, dagger-hygiene, prettier, markdownlint, check-suppressions/
  todos/migration-guard all clean.

### Remaining

- Confirm a fully green **local** `build-wasm.sh` compile (blocked here only by flaky
  network on emscripten port fetch). CI's Dagger emscripten stage is the authoritative
  build and exercises the same patch-apply path.

### Caveats

- Bare `make` in pristine `code/` omits our exports (documented footgun).
- `setup.ts` churned `packages/sjer.red/bun.lock` (unrelated); left unstaged.
