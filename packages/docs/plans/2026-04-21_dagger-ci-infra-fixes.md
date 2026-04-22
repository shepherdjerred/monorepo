# Dagger CI Infrastructure Fixes

## Status

**Not started (2026-04-21).** Punch list for a dedicated CI-infra PR. These bugs exist on `main` at commit `4b77c05f` independent of any dep updates; they make `dagger call ci-all --source .` unrunnable end-to-end locally. Documented while cleaning up Renovate Dashboard #481 — see `2026-04-21_renovate-dashboard-cleanup.md`.

## Context

`dagger call ci-all --source .` is the single umbrella pipeline that fans out lint/typecheck/test for every TS package plus Rust + Go. It lives in `.dagger/src/ci.ts` (`ciAllHelper`). Locally each package's `bun run lint/typecheck/test` and `cargo test` pass, but the Dagger orchestration fails because the containers are constructed with wrong working directories and missing tools. Buildkite CI runs per-package pipelines (not `ci-all`) which is why these bugs aren't felt in upstream CI.

## Bugs

### 1. Rust containers run at `/workspace` but `Cargo.toml` is at `packages/clauderon/`

`ciAllHelper` builds one `rustBaseContainer(source)` and runs `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test --all-features` against `/workspace`. All three fail with `error: could not find 'Cargo.toml' in '/workspace' or any parent directory`.

**Fix.** In `.dagger/src/ci.ts` lines ~84–115, chain `.withWorkdir("/workspace/packages/clauderon")` before the `cargo` execs, or move the mount so clauderon is the `/workspace` root for Rust work.

**Touched files:** `.dagger/src/ci.ts` (cargo fmt/clippy/test blocks), `.dagger/src/base.ts` (`rustBaseContainer` — consider making it accept a `pkgDir: string` parameter like `bunBaseContainer`).

### 2. Go containers run at `/workspace` but `go.mod` is at `packages/terraform-provider-asuswrt/`

Same pattern. `go build ./...`, `go test ./... -v`, and `golangci-lint run ./...` all fail with `pattern ./...: directory prefix . does not contain main module or its selected dependencies`.

**Fix.** Chain `.withWorkdir("/workspace/packages/terraform-provider-asuswrt")` before the three `go`/`golangci-lint` execs.

**Touched files:** `.dagger/src/ci.ts` (go build/test/lint blocks), `.dagger/src/base.ts` (`goBaseContainer`).

### 3. `bunBaseContainer` doesn't install `helm`, breaks homelab cdk8s tests

`packages/homelab/src/cdk8s/src/helm-template.test.ts` spawns `helm template test-release <tempDir>`. The container's `apt-get install` list in `bunBaseContainer` has `ca-certificates zstd python3 python3-setuptools make g++` but no `helm`. All 8 "Helm Escaping" tests fail with `Executable not found in $PATH: "helm"`.

**Fix options:**

- (a) Add `extraAptPackages: ["helm"]` when constructing the container for `homelab` — but helm isn't a Debian package; would need to `curl ... | sh` install it.
- (b) Pull helm from the `HELM_IMAGE` constant (`alpine/helm:4.1.3@sha256:...`) via `withFile("/usr/local/bin/helm", helmFile)` or a multi-stage copy.
- (c) Skip these tests when `helm` is absent (mark `it.skipIf(!which('helm'))`) — weakens the test gate but matches local dev when helm isn't installed.

**Recommended:** (b) via a helper that materialises helm into the bun container. Keeps the test real; no skips.

**Touched files:** `.dagger/src/base.ts` (`bunBaseContainer` or a new `withHelm(container)` helper), `.dagger/src/ci.ts` (homelab test wiring).

### 4. Clauderon/web workspace dep mounting — `@clauderon/shared` not resolvable

`packages/clauderon/web/` is a real bun workspace: root `package.json` + root `bun.lock` linking three sub-packages (`@clauderon/shared`, `@clauderon/client`, `@clauderon/frontend`) with `workspace:*`. But `WORKSPACE_DEPS` in `.dagger/src/deps.ts` treats each sub-package as its own unit:

```ts
"clauderon/web/shared": ["eslint-config"],
"clauderon/web/client":  ["eslint-config", "clauderon/web/shared"],
"clauderon/web/frontend": ["eslint-config", "clauderon/web/client", "clauderon/web/shared"],
```

`ciAllHelper` then calls `bunBaseContainer(pkgDir=packages/clauderon/web/client, ...)`. Inside the container `bun install --frozen-lockfile` runs against a sub-package that expects to be part of a workspace but isn't — so `@clauderon/shared` can't be resolved via `workspace:*`. Typecheck and lint cascade into ~20 `TS2307`/`no-redundant-type-constituents` errors.

**Fix options:**

- (a) Treat `clauderon/web` as a single package in `WORKSPACE_DEPS` and run the workspace's top-level `bun run lint/typecheck/test` (which already fans out via `bun run --filter='./*'`).
- (b) Mount the workspace root alongside each sub-package so `file:../shared` or `workspace:*` resolution works.

**Recommended:** (a). `packages/clauderon/web/package.json` already has `lint/typecheck/test` scripts that use `--filter='./*'`. Treat the workspace as atomic in `ciAllHelper`.

**Touched files:** `.dagger/src/deps.ts` (collapse the three entries into one `"clauderon/web"`), `.dagger/src/ci.ts` (nothing — loop stays the same).

### 5. Scout-for-lol/frontend hits 223 TS5097 errors in Dagger, passes locally

`packages/scout-for-lol/packages/frontend/tsconfig.json` extends `../../tsconfig.base.json`, which has `allowImportingTsExtensions: true` and `moduleResolution: "bundler"`. Locally `bun run typecheck` (`astro check`) passes cleanly. In Dagger the same invocation produces 223 `TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled` and a `TS2307: Cannot find module '@scout-for-lol/data/polling-config.ts'` with the hint "Consider updating to 'node16', 'nodenext', or 'bundler'".

This suggests either:

- The extends chain isn't resolving the parent tsconfig (mount layout issue — `source.directory("packages/scout-for-lol")` should include `tsconfig.base.json` at the workspace root but may not when `pkgDir` is `packages/scout-for-lol/packages/frontend`)
- `astro check` uses a different resolution in the container (check astro version pin, container PATH)

**Fix.** Audit the scout-for-lol container construction in `ciAllHelper`. The `dirsFor("scout-for-lol")` call returns `pkgDir = packages/scout-for-lol` (correct), but the `bunBaseContainer` mounts it at `/workspace/packages/scout-for-lol` — then how does `packages/frontend` inside there find `tsconfig.base.json` at `/workspace/packages/scout-for-lol/tsconfig.base.json`? Double-check that `SOURCE_EXCLUDES` doesn't strip the base tsconfig.

**Touched files:** `.dagger/src/ci.ts` (scout-for-lol block at lines ~136–169), possibly `.dagger/src/constants.ts` (`SOURCE_EXCLUDES`).

### 6. Pre-existing lint debt cascading from #4

Once #4 is fixed, these likely vanish because the underlying cause is unresolved shared types. Snapshot if they persist:

- `packages/clauderon/web/client/src/events-client.ts`: `'WsEvent' is an 'error' type that acts as 'any'` (5 errors, 1 warning)
- `packages/clauderon/web/frontend/src/**`: 11 `@typescript-eslint/no-redundant-type-constituents` + 1 `require-await`
- `packages/clauderon/mobile/src/**`: 15+ unsafe-assignment/member-access on unresolved `WsEvent`/`RecentReposSelector` types

## Verification Plan

After each fix lands:

```bash
# Target the specific failing check
dagger call ci-all --source . 2>&1 | tee /tmp/dagger-ci.log

# Or run a single package's checks to iterate faster
dagger call bun-base-container --pkg-dir ./packages/homelab --pkg homelab \
  --dep-names eslint-config --dep-dirs ./packages/eslint-config \
  --tsconfig ./packages/homelab/tsconfig.base.json \
  from-container --exec "bun run test"
```

End-to-end success: `dagger call ci-all --source .` exits 0 with all checks PASS in the summary, matching what Buildkite reports on upstream CI.

## Why This Matters

`ci-all` is meant to mirror Buildkite locally so devs can catch CI failures before pushing. Right now it can't — developers have to trust the per-package Buildkite pipelines. Fixing these unblocks:

- Pre-push local verification (`dagger call ci-all --source .` in a git hook)
- Fast iteration when debugging CI failures
- Dependency upgrades that want "would this break CI?" validation before merge (this whole Renovate Dashboard cleanup hit this wall)

## Related

- Plan: `2026-04-21_renovate-dashboard-cleanup.md` — the dep upgrade session that surfaced these infra bugs
- `.dagger/src/ci.ts` — `ciAllHelper`
- `.dagger/src/base.ts` — `bunBaseContainer`, `rustBaseContainer`, `goBaseContainer`
- `.dagger/src/deps.ts` — `WORKSPACE_DEPS`
- `.dagger/src/constants.ts` — `BUN_IMAGE`, `RUST_IMAGE`, `GO_IMAGE`, `HELM_IMAGE`, `SOURCE_EXCLUDES`
