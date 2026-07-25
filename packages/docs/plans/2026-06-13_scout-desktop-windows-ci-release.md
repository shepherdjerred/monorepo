---
id: plan-2026-06-13-scout-desktop-windows-ci-release
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout Desktop — CI build + upload + release of Windows x64 binaries

## Context

`@scout-for-lol/desktop` (`packages/scout-for-lol/packages/desktop`) is a Tauri 2 app
(Rust backend + Vite/React frontend). Today **nothing in CI compiles the Tauri/Rust binary** —
the Buildkite→Dagger pipeline only lint/typecheck/tests the scout-for-lol TS, and even the
desktop `test` script is a no-op `echo`. There are no Windows CI agents (the homelab Buildkite
stack is Linux/k8s only) and no GitHub Actions in this repo. The package already ships the
scaffolding _intent_ for a Linux→Windows cross-build: `desktop/.cargo/config.toml` wires the
`x86_64-w64-mingw32-gcc` linker with `crt-static`, and `desktop/.mise.toml`'s `setup` task installs
`mingw-w64 cmake nsis` + the rust target — but it has never run in CI.

**Goal:** build a Windows x64 installer in CI on every PR (validate) and on main merge, and on main
publish it to GitHub Releases.

## Locked decisions

| Decision             | Choice                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release destination  | **GitHub Releases** on `shepherdjerred/monorepo` via `gh release create` (GitHub App token already in CI)                                                        |
| Trigger + versioning | **Rolling on every main merge**: version `<base>-<BUILDKITE_BUILD_NUMBER>` where `<base>` = `tauri.conf.json` version (`0.1.0`). Releases marked `--prerelease`. |
| Auto-updater         | **Deferred** — ship the installer only; GitHub Releases keeps the updater path open for later                                                                    |

## Scope / non-goals

- **In scope:** Windows **x64** (`x86_64-pc-windows-gnu`) NSIS `.exe` installer only.
- **Out of scope (this change):** macOS/Linux artifacts; Windows ARM64 (`aarch64-pc-windows-msvc`
  cannot cross-compile off Windows); Tauri auto-updater + signed `latest.json`; and **code signing**
  (no cert — installer ships unsigned, so users see a Windows SmartScreen warning; listed as a follow-up).
- "Rolling on every main" is scoped to **desktop-affecting changes** (the desktop subtree or its TS
  deps `data`/`ui`, or a full build), not literally every unrelated main commit — consistent with the
  repo's change-detection philosophy and avoids re-publishing an identical binary. The build is still
  validated on every PR that touches those paths.

## ⚠️ Primary risk — cross-compile feasibility (spike FIRST)

Cross-compiling a Tauri app Linux→Windows via mingw is the one genuine unknown. De-risked points:
`reqwest` is configured with `rustls` (no OpenSSL), and `native-tls` maps to **SChannel** on Windows
targets (no OpenSSL cross-build needed). The remaining risk is `webview2-com-sys` / WinRT COM bindings
linking under mingw, and Tauri's NSIS bundler producing a working installer for the gnu target.

**Step 0 (before any CI wiring):** prove the build in a throwaway container that mirrors the planned
Dagger steps:

```bash
docker run --rm -it -v "$PWD:/w" -w /w/packages/scout-for-lol/packages/desktop \
  rust:1.95.0-bookworm bash
# install bun, mingw-w64, nsis, cmake, clang, lld; rustup target add x86_64-pc-windows-gnu
# bun install (from the scout-for-lol root); bun run build:windows
# confirm src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*-setup.exe exists
```

If mingw cross-build proves infeasible, **stop and surface it** — the fallback is infra the user must
choose (a self-hosted Windows Buildkite agent, or GitHub Actions `windows-latest` + `tauri-action`,
which deviates from the Buildkite-only setup). Do not silently switch approaches.

## Implementation

Mirrors the existing **build → push** image pattern: a build step validates; a publish step
(main-only) re-invokes the build helper (Dagger content cache → instant when unchanged) then
`gh release create`.

### 1. Dagger module — new `.dagger/src/desktop.ts` + wrappers in `index.ts`

Reuse existing patterns: `RUST_IMAGE`/`CARGO_REGISTRY`/`CARGO_TARGET`/`BUN_CACHE` from
`.dagger/src/constants.ts`; the dep-mount loops in `.dagger/src/base.ts` (`rustBaseContainer`,
`bunBaseContainer`); and the `withGithubAppCredentials` + GH-App-token-script publish flow from
`.dagger/src/release.ts` (`cooklangPublishHelper` at `:733`, `gh release create` at `:823`).

- `buildScoutDesktopWindowsHelper(scoutDir, depNames, depDirs, buildNumber, gitSha): Directory`
  - From `RUST_IMAGE`; `apt-get install mingw-w64 nsis cmake clang pkg-config lld`; install Bun
    (copy from `BUN_IMAGE` or the official installer); `rustup target add x86_64-pc-windows-gnu`.
  - Mount cargo caches (`/usr/local/cargo/registry`, `/workspace/target`) + bun cache.
  - Mount the **nested** scout-for-lol workspace: `packages/scout-for-lol` + the desktop's file: deps
    (`@scout-for-lol/data`, `@scout-for-lol/ui`) so they resolve. `bun install` at the scout-for-lol root.
  - Read base version from the mounted `tauri.conf.json`; compose `<base>-<buildNumber>`; write it into
    `tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml` (valid semver prerelease).
  - `bun run build:windows` (= `tauri build --target x86_64-pc-windows-gnu`; runs the `vite build`
    `beforeBuildCommand`).
  - Return the `…/release/bundle/nsis/` Directory (installer + any sidecars).
- `publishScoutDesktopWindowsHelper(scoutDir, deps…, buildNumber, gitSha, githubApp* secrets, dryrun): Promise<string>`
  - Calls the build helper (cache hit), then `withGithubAppCredentials` + `gh release create
"scout-desktop-v<version>" <installer> --repo shepherdjerred/monorepo --title … --notes "<gitSha>"
--prerelease`. `dryrun` → echo only (PR path / non-main).
- `.dagger/src/index.ts`: add `@func() buildScoutDesktopWindows(...)` and
  `@func({ cache: "never" }) publishScoutDesktopWindows(...)` thin wrappers (pattern at `index.ts:451-484`),
  exporting the helpers via the `index.ts` import block.

### 2. CI generator — `scripts/ci/src/`

- **`catalog.ts`**: add a dedicated registry (e.g. `SCOUT_DESKTOP_WINDOWS`) with the build/publish
  Dagger fn names + the scout dep dirs (`data`, `ui`). Not an `ImageTarget` (it's not a container) —
  keep it separate. Assign resource tier **HEAVY** (the BK pod is a thin dagger wrapper; compute is remote).
- **`change-detection.ts`** (+ `lib/types.ts`): add `scoutDesktopChanged: boolean` to `AffectedPackages`,
  true when changed files touch `packages/scout-for-lol/packages/desktop/`, `…/packages/data/`,
  `…/packages/ui/`, or `buildAll`.
- **`steps/desktop.ts`** (new), wired in `pipeline-builder.ts`:
  - Build step (PR + main): `dagger call build-scout-desktop-windows --pkg-dir <git-url-ref> --dep-* …
--build-number $BUILDKITE_BUILD_NUMBER --git-sha $BUILDKITE_COMMIT`. `depends_on: quality-gate`,
    `timeout_in_minutes: 60`, HEAVY resources, `retry`. (Optional: `export` the installer + set
    `artifact_paths` so PR builds produce a downloadable installer for manual testing.)
  - Publish step (`if: MAIN_ONLY`): `dagger call publish-scout-desktop-windows … <GITHUB_APP_SECRET_ARGS>`
    - `--dryrun` on non-main (reuse `DRYRUN_FLAG`). `depends_on:` the build step.
  - Gate both steps on `affected.scoutDesktopChanged` in `pipeline-builder.ts` (next to the image-build
    block, `pipeline-builder.ts:233-295`); add the build key to the `ci-complete` deps.

### 3. Desktop package — minor config

- `src-tauri/tauri.conf.json`: optionally pin `bundle.targets` for Windows to `["nsis"]` (currently
  `"all"`) to make the produced artifact explicit. Low priority — `"all"` already yields NSIS on the
  gnu target.
- No source code changes required.

### 4. Docs

- Update `packages/scout-for-lol/packages/desktop/README.md` "Building Installers" and the scout
  `CLAUDE.md` CI section to document the CI build/release.
- Move this plan to `packages/docs/archive/completed/` once shipped (per docs discipline).

## Release / version semantics

- Version: `0.1.0-<BUILDKITE_BUILD_NUMBER>` (base from `tauri.conf.json`). Bump the `0.1.0` base
  manually when cutting a "real" version.
- Tag: `scout-desktop-v0.1.0-<build#>`, marked `--prerelease` so it never becomes the repo's "Latest
  release" (won't collide with release-please's package tags).
- Asset: `Scout for LoL_<version>_x64-setup.exe` (NSIS). Unsigned.
- PR builds: build only; `--dryrun` on the publish path → no release created.

## Verification

1. **Spike (Step 0)** — the `docker run` above produces a `*-setup.exe`; sanity-check on a Windows
   box/VM that it installs and the app launches (LCU connect can fail; just confirm it boots).
2. **Local Dagger** — `cd .dagger && dagger call build-scout-desktop-windows --pkg-dir
../packages/scout-for-lol --dep-names data --dep-dirs … --build-number 0 --git-sha local
export --path /tmp/out` → installer present.
3. **Publish dry-run** — `dagger call publish-scout-desktop-windows … --dryrun` prints the intended
   `gh release create` with no side effects.
4. **Pipeline generator** — `cd scripts/ci && bun test` (extend `__tests__/pipeline-builder.test.ts`
   to assert the build/publish steps appear when `scoutDesktopChanged`, and the publish step is
   `MAIN_ONLY`); `bun run src/main.ts` with a faked desktop change emits the steps.
5. **End-to-end** — open a PR touching the desktop subtree: confirm the build step runs (no release);
   after merge to main, confirm the prerelease + attached `.exe` appears in GitHub Releases.

## Follow-ups (not in this change)

- Code signing (OV/EV cert) to remove the SmartScreen warning.
- Tauri auto-updater: add `tauri-plugin-updater`, generate + sign `latest.json`, host it alongside the
  release, add the update-check UI.
- macOS/Linux artifacts (generalize the Dagger helper across targets).
- Prune old desktop prereleases on a schedule to keep the Releases list tidy.

## Session Log — 2026-06-13

### Done

- Researched the desktop package, the CI pipeline generator (`scripts/ci/src/`), the Dagger module
  (`.dagger/src/`), and the upload/release infrastructure; confirmed the desktop binary is built
  nowhere in CI and no Windows agents / GitHub Actions exist.
- Captured locked decisions (GitHub Releases · rolling version on every main · auto-updater deferred)
  and wrote this plan.

### Remaining

- Implement the plan: Dagger `desktop.ts` helpers + `index.ts` wrappers; `catalog.ts` /
  `change-detection.ts` / `steps/desktop.ts` wiring in the CI generator; optional `tauri.conf.json`
  target pin; README/CLAUDE.md docs. **Spike the mingw cross-build (Step 0) before wiring CI.**

### Caveats

- Tauri Linux→Windows cross-compile via mingw (`webview2-com-sys`, NSIS bundler) is unproven in this
  repo — the spike gates the rest of the work. Fallback (Windows BK agent or GitHub Actions +
  tauri-action) is a user-facing infra decision, not to be taken silently.
- Installer ships **unsigned** (SmartScreen warning) until a code-signing cert is procured.

## Remaining

- [ ] Complete and verify the work described in `Scout Desktop — CI build + upload + release of Windows x64 binaries`.
