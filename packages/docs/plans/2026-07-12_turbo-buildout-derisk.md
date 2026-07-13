# Turbo Build-Out & De-Risk (pre-Phase-2)

## Status

In Progress

## Context

Turbo was chosen as the Layer-2 runner (see `packages/docs/plans/2026-07-12_workspace-taskgraph-replatform.md`), but its PoC is shallower than moon's de-risk pass. Verified so far: caching/`--affected`/ordering, one full typecheck sweep (`--continue`, 57 tasks/33 s), remote-cache round-trip **on local disk only**, script-less no-op semantics. This plan closes the remaining gaps so Phase 2 (landing turbo) starts from a production-shaped, de-risked config instead of a demo `turbo.json`. Output = commits on the `spike/workspace-taskgraph` worktree + updates to the replatform plan doc + a go/no-go checklist for Phase 2.

All work happens in `.claude/worktrees/spike-ws` (existing spike). **Compute protocol** (standing, after the fork-bomb incident): foreground only, `--concurrency=2..4`, umbrella packages excluded, one heavy command at a time, `ps -A | wc -l` between batches; anything repo-wide beyond the listed sweeps needs fresh user go-ahead.

## De-risk gaps → work items

### 1. Production `turbo.json` (the core deliverable)

Rewrite the demo config into the real one:

- `globalDependencies`: `mise.toml`, `bunfig.toml`, `patches/**`, root `package.json` (toolchain/linker/patch changes must bust every task).
- Per-task `inputs`/`outputs` from the audit (Explore agent report — tables to be folded in): correct `outputs` for every build (fixes the `report`/`home-assistant` "no output files" warnings), exclude generated/vendored dirs from inputs where needed.
- **`env` hashing audit**: tasks whose results depend on env vars (test preloads setting `S3_BUCKET_NAME`, `JWT_SIGNING_SECRET`, etc.) must declare them in `env`, or caching is *incorrect* (a wrong-cache-hit correctness bug, the worst failure class). Audit table drives per-package `env` entries; sanity-test one package by flipping a declared env var and confirming a cache miss.
- `"daemon": false` initially — the turbo daemon is a persistent background process on dev machines; given this machine's history, opt out until there's a demonstrated need.
- Pin exact version (spike used 2.10.4; verify whether the shared-worktree-cache + `--continue` behaviors exist in the current 2.9.x stable and pin the newest line that has what we use).

### 2. `generate` split: local vs live codegen

- `generate` (cached, in `typecheck`/`test` dependsOn): Prisma only — birmel, scout backend, dpmk backend.
- `generate:live` (NOT in any default chain, `cache: false`): temporal (needs live HA), helm-types (needs chart repos). Their own `typecheck` scripts already self-manage stubs — verified in the sweep.
- Implementation: rename/wire scripts accordingly in the spike; turbo.json `generate` task keeps `outputs: ["generated/**"]`.

### 3. Native/WASM shim proof (the moon-parity question)

Prove turbo's shim story on real native code:

- Shim package.json for `packages/scout-for-lol/packages/desktop/src-tauri` (or a `native-checks` shim inside desktop): scripts `lint: cargo fmt --check` (+ `clippy` as a separate script — clippy compiles, so it's the expensive/valuable cache case), registered in workspaces.
- Verify: task runs via turbo, caches, `--affected` selects it on `.rs` touch only, and (for a build-artifact case) declared `outputs` round-trip through the remote cache.
- WASM: evaluate `pokeemerald-wasm` build feasibility in the spike (it was a Dagger function; if the emscripten/docker build is runnable locally in bounded time, shim it and cache the `.wasm` as outputs — this is the highest-value artifact-caching proof; if not bounded, document the shim design and defer execution to Phase 2).

### 4. Remote cache on Cloudflare R2 (user decision: R2)

- Declare the R2 bucket as **tofu IaC** in `packages/homelab/src/tofu` (this is the Phase-3 production bucket, created once, reviewable): bucket `turbo-cache` + scoped R2 API token. User runs/apporves the apply (I don't create cloud resources unilaterally).
- Run the dockerized ducktors server locally with `STORAGE_PROVIDER=s3`, endpoint `https://<account>.r2.cloudflarestorage.com`, the new bucket + keys.
- Repeat the proven round-trip: cold cache-dir A run (miss→PUT), cold cache-dir B run (GET, FULL TURBO), confirmed via server request log AND R2 object listing.
- Document R2 S3-compat quirks encountered (multipart, signatures) in the plan doc.

### 5. Test tasks through turbo (bounded)

- From the audit: classify each package's `test` as hermetic vs env-dependent; integration/e2e scripts stay OUT of the default `test` task (run manually / future CI stages with creds).
- Wire `test` in turbo.json with correct `env` declarations; run a **sample** (5-6 known-hermetic packages, foreground, `-c 2`) through turbo twice to prove cache-hit-on-rerun and log replay. NOT a full test sweep (needs separate go-ahead).

### 6. Root-level tasks

- Wire the orphan check scripts as root turbo tasks (`//#markdownlint`, `//#check-todos`, `//#check-suppressions`, `//#compliance-check`) with proper inputs so they cache. Run each once. (knip deferred — needs full install + its config quirks; note only.)

### 7. Cache-location & hygiene decisions

- Shared worktree cache lives in the **main checkout's** `.turbo/cache`: keep (it's the cross-worktree win) but ensure `.turbo` is gitignored on the branch that lands (already done in spike) and note the location in docs.
- `TURBO_TELEMETRY_DISABLED=1` decision; `--summarize` off by default.

### 8. Lint via turbo (smoke only)

- `lint` task exists in turbo.json; run for 2-3 packages to confirm eslint works under turbo + caches (eslint needs built `eslint-config` — `dependsOn: ["^build"]` already covers). Full lint sweep deferred (slow; separate go-ahead).

## Explicitly out of scope

- Landing anything on main (this is all spike-branch de-risk; Phase 1 #1408 refresh is a separate session).
- Full test/lint sweeps repo-wide.
- Deploying the ducktors server to k8s (Phase 3; this plan only proves R2 storage compat).
- moon config changes (frozen as fallback).

## Verification

- `turbo run typecheck --filter=<pkg>` twice → FULL TURBO on second, for: birmel (Prisma), a shim package (native), one env-declared test package.
- Env-hash correctness: flip a declared env var → cache miss; flip an undeclared/irrelevant var → still FULL TURBO.
- R2 round-trip: server log PUT/GET 200s + `aws s3 ls` (R2 endpoint) shows artifacts; cold-client FULL TURBO.
- `--affected` on `.rs` touch selects only the shim + dependents.
- Final: one bounded re-run of the typecheck sweep (`--continue`, `-c 2`, umbrellas excluded) to confirm the production config didn't regress the 49-passing baseline; wall time recorded.

## Deliverables

1. Commits on `spike/workspace-taskgraph`: production `turbo.jsonc`, generate split, native shim, test/env config.
2. Tofu commit (homelab): R2 bucket + token resources (user-applied).
3. Replatform plan doc updated: audit tables, R2 round-trip results, go/no-go checklist for Phase 2.
4. Chat summary of any NEW risks found (or confirmation none).
