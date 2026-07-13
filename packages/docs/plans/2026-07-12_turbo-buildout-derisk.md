# Turbo Build-Out & De-Risk (pre-Phase-2)

## Status

Partially Complete — graph fully green (57/57), all local items done; only the R2 round-trip remains (user: tofu apply + S3 token).

## Context

Turbo was chosen as the Layer-2 runner (see `packages/docs/plans/2026-07-12_workspace-taskgraph-replatform.md`), but its PoC is shallower than moon's de-risk pass. Verified so far: caching/`--affected`/ordering, one full typecheck sweep (`--continue`, 57 tasks/33 s), remote-cache round-trip **on local disk only**, script-less no-op semantics. This plan closes the remaining gaps so Phase 2 (landing turbo) starts from a production-shaped, de-risked config instead of a demo `turbo.json`. Output = commits on the `spike/workspace-taskgraph` worktree + updates to the replatform plan doc + a go/no-go checklist for Phase 2.

All work happens in `.claude/worktrees/spike-ws` (existing spike). **Compute protocol** (standing, after the fork-bomb incident): the machine is powerful — the hazard is UNBOUNDED fan-out (nested `bun --filter` umbrella scripts, orphaned process accumulation), which hangs any machine. Every fan-out must carry a concurrency bound (turbo `--concurrency`, cargo `-j`); umbrella packages stay excluded until their scripts are deleted. With bounds in place, generous parallelism is fine.

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

## Results (2026-07-12 execution)

| Item | Result |
| --- | --- |
| Production turbo.json | Landed: `.mise.toml`/`bunfig.toml`/`patches/**` globalDependencies, exact 2.10.4 pin, 6 package-level `turbo.json` overrides (report/home-assistant `outputs: []`, resume pdf, birmel test `cache:false` — gitignored `.env.test` is unhashable, scout-backend test `env: DATABASE_URL`). `daemon` key dropped (2.10 no longer uses a daemon for `run`) |
| Env-hash correctness | PROVEN: declared `DATABASE_URL` flip → MISS; undeclared var → HIT. Full scout-backend suite replays in 81 ms |
| generate split | `generate:live` (temporal, helm-types; `cache:false`, no default chain) vs cached `generate` (birmel, scout-backend, dpmk-backend). Verified temporal typecheck self-manages via stub |
| Native shim (rust) | `cargo fmt` + `clippy` in the graph via shim package.json. **Clippy: ~1m40s cold → 164 ms cached (FULL TURBO)** — the expensive-check case proven. Two prerequisites found: tauri's `generate_context!` needs `../dist` to exist (placeholder `index.html` suffices; Phase 2 wires a dependsOn or keeps the convention) |
| **Finding: nested-package `--affected` is broken in turbo 2.10.4** | Three code paths, three answers for a file in a package-inside-package: `turbo ls --affected` → correct (deepest); `run --affected` tasks → parent package; dry-run `.packages` → umbrella. **Under-selects the nested package's own tasks (unsafe direction).** Cache keys ARE correct (`.rs` edit busts the shim's hash) → workaround: native shim tasks run unconditionally, cache absorbs (76-164 ms replays). Phase-1 options: de-nest the crate, or live with unconditional runs. Worth an upstream issue |
| WASM (pokeemerald) | Deferred by design: the wasm was built from source in the removed CI image (custom audio patches); no local build path exists today. Phase-2 design: shim package + dockerized emscripten build + `outputs: ["*.wasm"]`, remote-cached — identical pattern to the rust shim |
| Test sample | 6 hermetic packages (webring, llm-models, eslint-config, tasknotes-types, home-assistant, trmnl-dashboard): 8/8 tasks pass, rerun FULL TURBO 82 ms |
| Root tasks | `//#check-todos`, `//#check-suppressions`, `//#markdownlint` wired with scoped inputs; `scripts/` added as a workspace member (its deps were never installed under the workspace — zod failure found). check-todos correctly caught a real violation: `discord-stream-lifecycle/bunfig.toml:8` marker `todo:bun-isolated-linker-eexist` has no doc on this branch (Phase-1 reconcile) |
| Root fan-out scripts | DELETED from root package.json (build/test/typecheck/lint) — closes the bun walk-up hazard on the spike branch |
| Final sweep | `typecheck --continue -c 2` (umbrellas excluded): **50/56 pass, 24 s wall** — failures reduced 8 → 6 vs baseline (both live-generate failures eliminated); remaining 6 = the 3 known Phase-1 root causes. No regressions |
| R2 | `cloudflare_r2_bucket.turbo_cache` + 30-day lifecycle written and `tofu validate`-clean (`packages/homelab/src/tofu/cloudflare/turbo-cache.tf`). **BLOCKED on user**: `tofu apply` + mint bucket-scoped S3 token; then rerun the proven ducktors round-trip against R2 |
| Machine safety | Entire execution foreground/bounded; process count flat; zero incidents |

## Build-out round 2 (2026-07-12, "keep building")

| Item | Result |
| --- | --- |
| **Full graph GREEN: 57/57 tasks**, force-executed in 24 s at `-c 4`; **warm sweep 0.26 s** (57/57 cached) | First fully-green repo-wide verification since CI removal |
| Strict `envMode` | **Confirmed empirically**: undeclared env vars are filtered from task environments (`PROBE: filtered`) — env caching is fail-closed, not fail-silent. Caveat resolved |
| All 6 sweep failures fixed | dpp/dpmk-common: explicit `rootDir` (TS6). cooklang: real `bun-types`/happy-dom deps + `override` modifiers. scout-backend: `--external '@duckdb/*'`. All were phantom-dep/latent bugs the isolated linker + graph surfaced |
| **discord-plays-core converted** to workspace member | Root cause of dpp/dpmk backend failures: dpc was umbrella-hoisted (a phantom by design); backends now declare `workspace:*`. Also purged stale real-dir node_modules left by moon's rogue auto-install |
| Umbrella fan-out scripts DELETED (+ dsl hoisted-linker pin, + vestigial builds) | The `--filter` exclusion hack is gone; sweeps run unfiltered. `check-todos` green |
| **New finding: concurrent Prisma generates race** the shared engine cache (flaky `scout-backend#generate` at `-c 4`) | Same race the old setup.ts DAG guarded; fixed with the same synthetic `dependsOn` edge (scout generate → birmel generate), documented as deliberate non-dependency |
| scout-backend `template.db` was an undeclared output | Added to `outputs` (cache restore now covers it) |
| Lint smoke | Green after adding llm-models' own eslint+jiti (phantom); webring/tasknotes-types already correct. Full lint sweep will surface this per-package — mechanical |

## Phase-2 go/no-go checklist

- [x] Production config exists and is exercised (this branch)
- [x] Caching correctness: inputs, outputs, env all verified
- [x] Native/polyglot story workable (shim + unconditional runs + cache)
- [x] Live-codegen isolated from default chains
- [x] Root checks in the graph; root fan-out scripts deletable
- [ ] R2 storage round-trip (user steps above, then ~10 min of verification)
- [x] Phase-1 fixups: ALL DONE on the spike branch (rootDir, duckdb, bun-types, check-todos/dsl pin, home-assistant/report vestigial builds, dpc conversion, umbrella deletion). anki has no scripts — nothing to fix under turbo

## Session Log — 2026-07-12 (execution)

### Done
- All plan items executed except the R2 half of item 4 (user-blocked). Commits on `spike/workspace-taskgraph`: c13080063 (config), 2753f05a8 (rust shim), a53a1ccf8 (tofu), 9071cb5b6 (root tasks). Docs mirrored + updated on `feature/rip-setup` (PR #1517).

### Remaining
- User: `tofu apply` in `packages/homelab/src/tofu/cloudflare` (spike worktree) + mint R2 S3 token → then I rerun the ducktors round-trip against R2 and check the box.
- Consider filing the nested-package `--affected` bug upstream (vercel/turborepo) with the three-code-paths repro.

### Caveats
- The spike branch now intentionally diverges from #1408 (generate renames, root script deletions, shim) — Phase 1 should treat the spike as the reference implementation for these changes, not merge it blindly.
- check-todos left failing on the branch (real violation, honest signal).
