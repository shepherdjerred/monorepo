# Workspace + Task Graph Replatform (Local Dev Layers 1 & 2)

## Status

In Progress — design drafted from investigation spikes, awaiting user review.

Origin: 2026-07-12 session. Prereqs in flight: PR #1516 (remove all CI), PR #1517 (remove `scripts/setup.ts`, stacked on #1516).

## Goal

**One task graph, executed everywhere.** Local dev, agents, and (future) CI run the same commands against the same cache. CI later becomes a thin runner of this graph — no second build system to drift (the Bazel and Dagger failure mode, twice).

- **Layer 1** — make the repo a real Bun workspace: one install, one lockfile, `workspace:*` symlinks instead of `file:` copy-glue.
- **Layer 2** — Turborepo on top: cached, dependency-ordered, affected-aware task running.

## Key discovery: PR #1408 already is Layer 1

An open PR (**#1408**, branch `fix/webring-truncate-html`, updated 2026-07-11) contains a complete single-workspace migration: 45 members (nested dpp/dpmk/scout/homelab families flattened into root globs), ONE `bun.lock`, `linker = "isolated"`, all internal deps `workspace:*`, per-package lockfiles + drift gate deleted, real hoisting bugs fixed (`patchedDependencies` for bun-types phantom deps, Prisma output moved in-repo).

Its verification strategy was "let Buildkite verify the sweep" — and CI was then removed, stranding it. **This session's spike verified it locally instead** (below). Layer 1 is therefore "refresh and land #1408", not a greenfield build. (Evaluated empirically per the no-prior-plans directive; the recommendation stands on the spike results, not on the PR's own docs.)

## Spike evidence (2026-07-12, branch `spike/workspace-taskgraph`)

Spike = #1408 merged with the CI+setup removal (`feature/rip-setup`), then exercised on a MacBook.

| Check | Result |
| --- | --- |
| Cold-ish root `bun install`, 45 members, isolated linker | **5,817 packages in 6.3 s**, zero errors, no EEXIST |
| `node_modules` footprint | **4.0 GB** (vs 13–15 GB as 36 separate installs) |
| Internal dep resolution | **Symlinks to package source dirs** → producer rebuilds propagate instantly; the whole "stale copied `dist/`" bug class (and setup.ts's force-copy phase) is structurally dead |
| Prisma under isolated linker | `generate` + typecheck green in birmel and scout backend |
| Producer-before-consumer failures | Reproduce exactly as predicted when producers unbuilt (`llm-models` dist missing) — the task graph's job |
| turbo 2.10.4 + bun.lock | Reads workspace graph, dependency-ordered runs (`^build` before typecheck) |
| turbo caching | Stable after adding `.turbo` to `.gitignore` (its per-package log self-invalidated hashes until then — mandatory setup step). Second run: **FULL TURBO, 73 ms** vs ~4 s uncached |
| turbo cache across worktrees | Shared automatically ("shared worktree cache", turbo ≥2.10) |
| `turbo run --affected` | Clean tree → 0 tasks. One file touched in `llm-models` → exactly its transitive dependents (scout family, dpp backend, temporal, monarch) + their upstream builds |
| Prisma generate determinism | Byte-identical across runs (aggregate sha match) → safe as a cached task with `generated/**` outputs |
| npm publish with `workspace:*` deps | `bun pm pack` rewrites the protocol to the concrete version (webring: `workspace:*` → `0.3.0` in the tarball) |

## Research findings

### Turborepo + Bun (research agent, verified against docs/issues)

- Bun 1.2+ is **officially Stable** in turbo 2.x; turbo parses text `bun.lock` for the graph. Current line: 2.9.x stable / 2.10.x canary ("Turborepo 3.0" blog claims are fiction).
- **`turbo prune` is the fragile part** — recurring bun.lock corruption (vercel/turborepo#12262, #11266, #11007). Decision: **never use prune**; Docker builds keep plain `bun install`.
- **Bun 1.4 wall**: lockfileVersion 2 is unsupported by turbo (discussion #13126, open) — losing the whole workspace graph. Decision: **stay on bun 1.3.x until turbo ships v2 lockfile support**; mark the mise bun pin notify-only for 1.4.
- Remote cache: ducktors/turborepo-remote-cache (v2.11.2, active) is a drop-in self-host with S3-compatible backends; auth = static team token. R2 is the lower-risk backend; SeaweedFS unverified by the project (needs a real round-trip test before trusting).
- No-output tasks (typecheck/lint) still cache (log + exit-status replay) — the biggest repeat-run win.
- `--affected` = `--filter=...[main...HEAD]`, override via `TURBO_SCM_BASE`; root-file changes fan out to everything by design.

### moon / alternatives (research agent)

- **The real contest is moon vs turbo.** moon (v2.4.3, weekly releases, ~50K dl/wk): Bun is a first-class *managed* toolchain; unified affected-graph across TS+Rust+Go+Python; remote cache via **Bazel REAPI v2** → self-hostable `bazel-remote` with S3 backends (moonbase itself was sunset 2025-03). Costs: per-project `moon.yml` config sprawl, v2 plugin rewrite is only ~2 months old, community ~40× smaller than turbo.
- **Nx: avoid.** Bun is second-class; self-hosted S3 cache packages **deprecated 2026-05 over CVE-2025-36852** (architectural cache poisoning) → Nx Cloud lock-in; plus the Aug 2025 s1ngularity supply-chain breach.
- **Bun-native task caching: does not exist and isn't planned** (oven-sh/bun#14731 is a cache-less script runner proposal). An external runner is required regardless.
- Wireit/Lage underpowered; Bazel/Buck2/Pants re-litigate the tax this repo just escaped.

**Call for this repo: turbo.** The polyglot tail is small (1 Rust crate, 2 Go modules, Python scripts — each already covered by simple direct commands), the repo's mass is TS, and turbo is spike-verified here with a one-file, easily-reversible config. moon + bazel-remote is the documented fallback if the turbo remote-cache path disappoints — tasks stay in package.json scripts either way, so switching runners later is cheap.

### Bun workspace maturity (research agent)

- **Linker**: bun 1.3.x defaults *new* workspace lockfiles (configVersion 1) to **isolated**, which has a real bug trail — catalog dedup breakage (#23615), non-determinism (#23548, fixed), install hangs (#22846, fixed) — mostly 1.2.22–1.3.0 era. Agent recommends pinning `linker = "hoisted"`. **This plan keeps isolated anyway** — see Design decision 2 for the reconciliation; hoisted stays as the one-line escape hatch.
- **Prisma**: postinstall is gated by `trustedDependencies`; explicit `bun run generate` (already the repo pattern, kept by #1408) sidesteps postinstall ordering entirely. Symlink-backend engine breakage is real (matches the old `--link` rejection) but did **not** reproduce under isolated on 1.3.14 in the spike — generate, typecheck, and runtime module resolution of the generated client all verified.
- **Nested workspaces: unsupported** (oven-sh/bun#2592) — scout/dpp/dpmk families must flatten into root globs with globally-unique names. #1408 already does exactly this.
- **Catalogs**: `catalog:` works but **Renovate cannot update catalog entries as of 2026** and catalogs interact with the worst isolated-linker bug. → Skip catalogs for now (Design decision 10).
- **`bun run --filter` has NO concurrency cap** (`--concurrency` is an open, unreleased request — oven-sh/bun#27858, whose motivating example is precisely the typecheck-fan-out OOM this repo hit). → Root fan-out goes through turbo (`--concurrency`) exclusively, never `bun --filter '*'` (Design decision 4).
- **Publish gotcha** (oven-sh/bun#20477): `bun pm pack` takes versions from `bun.lock`, not the dep's package.json — run a fresh `bun install` before publishing interdependent packages.
- **Lockfiles don't merge**: delete the 45 per-package locks, one fresh install regenerates a single lock, and version drift must be audited (36 independent resolutions collapse to one per name). #1408 already ate this (e.g. its protobufjs union call).

## Head-to-head PoC: turbo vs moon (2026-07-12, same spike branch)

Both installed repo-locally on `spike/workspace-taskgraph` and driven against the same tasks.

| Axis | turbo 2.10.4 | moon 2.4.3 |
| --- | --- | --- |
| Setup to first cached run | One `turbo.json` (+ `packageManager` field) covered all 45 packages | `.moon/workspace.yml` + `.moon/toolchains.yml` + `inferTasksFromScripts` |
| Cache hit (birmel typecheck chain) | 73 ms (FULL TURbo) | 191 ms ("to the moon") — same class |
| Cache footguns | `.turbo` logs must be gitignored or every hash self-invalidates (hit it) | None hit — cache state lives outside project dirs |
| Cross-project ordering (`^build`) | 4 lines, applies everywhere | **Script-inferred tasks cannot take deps** (verified: inherited `.moon/tasks.yml` deps are ignored by inferred tasks) → production moon means real task configs across ~45 projects (per-project `moon.yml` or inherited task files + de-scripted packages) |
| Project identity | package.json names (already unique) | **Folder names → collisions** (dpp/dpmk/scout `backend`/`frontend`/`common`); needed 14 hand-mapped `sources` entries |
| Native (Rust) project | Needs a package.json shim (not exercised) | **7-line `moon.yml`, no shim** — `cargo fmt --check` ran + cached (117 ms hit) in the same graph |
| Polyglot affected | n/a (JS graph only) | Touch one `.rs` file → `scout-desktop-rust` + downstream selected; clean tree → 0. Works |
| Docs/version drift | — | v1 `.moon/toolchain.yml` (singular) is **silently ignored** by v2 (`toolchains.yml`); config keys moved (`javascript.packageManager`) |
| Toolchain | Uses ambient bun (mise) | Downloads/pins its own bun via proto — redundant with mise |

**Read:** both pass the fundamentals on this repo. turbo's total config cost for full coverage was ~20 lines; moon's full-production cost is real per-project config (inference is explicitly a prototyping bridge — it can't express the producer-build ordering this repo depends on). moon's polyglot graph is genuinely better and its per-native-project cost is tiny (7 lines); its per-TS-project cost is the sticking point at 45 projects.

**Environmental finding (affects both):** the main clone had a **shallow graft** (`.git/shallow`, created 2026-07-12 14:37 by some `--depth` fetch) which silently disables all history-based affected detection — moon warned loudly; turbo's `--affected` only worked in earlier tests because they used `TURBO_SCM_BASE=HEAD`. Fixed with `git fetch --unshallow`; worth finding what re-shallows the clone.

## moon de-risk pass (2026-07-12, user prefers moon for the polyglot graph)

| Risk | Result |
| --- | --- |
| Config cost at 45 TS projects | **Solved with inheritance + opt-outs.** `.moon/tasks/all.yml` (one file, turbo.json-equivalent) defines build/typecheck/test/lint with `^:build` deps; `generate` is per-project. Script coverage across 45 members: typecheck missing in 2, lint 3, test 7, build 9, generate present in only 7 → total ≈ **1 workspace file + ~17 small per-project files** (opt-outs via `workspace.inheritedTasks.exclude`, generate declarations). Verified: `^:build` correctly skips opted-out projects; `optional: true` deps skip absent `generate` |
| Inherited task on script-less project | Hard failure (`Script not found`) — hence the opt-out model above; turbo doesn't have this class (tasks exist only where scripts do) |
| Codegen output hydration | `generated/**` restored after `rm -rf`; follow-up runs cached (113 ms) |
| **Remote cache (REAPI)** | **Full round-trip verified** against dockerized `bazel-remote`: execute → upload → wipe local `.moon/cache` → **"cached from remote, 1ms"**. This was moon's biggest unverified claim post-moonbase |
| CI heuristic foot-gun | moon treats **no-TTY as CI** and refuses *localhost* remote endpoints in CI mode (agent shells / scripts always hit this). Also: any `BUILDKITE*` env var (the fish profile exports `BUILDKITE_API_TOKEN`) puts moon in Buildkite-CI mode machine-wide, changing affected-detection defaults. Mitigations: production remote host is non-localhost (guard doesn't apply); consider un-exporting the BK token from the interactive profile |
| Toolchain duplication | moon/proto downloaded its own bun 1.3.14 (~126 MB in `~/.proto`) next to mise's. Acceptable; alternatively omit `bun.version` to use PATH bun |
| Config schema drift (v1→v2) | Three silent-ignore incidents in one session: `.moon/toolchain.yml` (now `toolchains.yml`), `inferTasksFromScripts` moved under `javascript`, `.moon/tasks.yml` (now `.moon/tasks/**`). Pin moon exactly; validate configs against the v2 schemas when upgrading |
| Local cache across worktrees | Per-workspace (`.moon/cache` at each worktree root) — no local sharing (turbo 2.10 shares). The remote cache covers this |
| Full-workspace sweep | `moon run :typecheck -c 4` works but **`moon run` bails on first failure** (no `--no-bail`; `moon ci` is the continue-through mode). Partial per-project inventory before the incident below: PASS astro-opengraph-images, better-skill-capped, birmel, cooklang-rich-preview; FAIL anki (its `typecheck` delegates to root `run-package-script.ts`, which needs a root `zod` that no longer exists), cooklang-for-obsidian, discord-plays-core, discord-plays-mario-kart. Completing the inventory is Phase-1 work |

### ⚠ Incident: fork-exhaustion crash during the sweep (machine reboot)

The per-project inventory loop crashed the MacBook (fork exhaustion → reboot). Chain: **umbrella projects** (`discord-plays-mario-kart`, `discord-plays-pokemon`, `scout-for-lol`) have `typecheck` scripts that fan out over their sub-packages with **unbounded `bun --filter`**; moon ran those *as tasks* under `-c 4` (the cap bounds moon's tasks, **not what each task spawns**), while orphaned tsc/bun children from earlier aborted sweeps accumulated. Guardrails now binding:

1. **Umbrella fan-out scripts are a fork bomb under any task runner.** The migration must DELETE the umbrella packages' `--filter`-fan-out scripts (moon/turbo runs leaf projects natively; the umbrellas keep only their genuinely-own tasks).
2. Until then, umbrella projects are excluded from inherited runner tasks.
3. Repo-wide sweeps: one at a time, foreground, `-c 2`, with process-count monitoring — and never while other agent sessions are active. (Reaffirms the 2026-07-11 jetsam log.)

## Design decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Layer 1 = refresh and land **PR #1408** (rebased onto post-#1516/#1517 main; its Dagger/CI-generator changes dissolve in the rebase) | Complete, spike-verified; greenfield would re-derive the same tree |
| 2 | Keep **isolated linker** + `patchedDependencies` from #1408, with `linker = "hoisted"` documented as the one-line rollback | Research (hoisted) and spike (isolated) disagree; the spike wins on recency and directness: the cited isolated bugs are 1.2.22–1.3.0 era and fixed or catalog-dependent (we skip catalogs), while 1.3.14 isolated passed install, Prisma generate, typecheck, and runtime client resolution here. Isolated also kills the phantom-dep class #1408 fixed real bugs for. Gate: Phase 1's full test sweep must pass before merge; any isolated-linker weirdness → flip to hoisted, not debug-forever (complexity-spiral rule) |
| 3 | Layer 2 = **moon 2.4.3, pinned exactly** (`@moonrepo/cli` devDep), per user preference for the polyglot graph. Config model: `.moon/tasks/all.yml` (build/typecheck/test/lint with `^:build` + optional `~:generate` deps) + ~17 small per-project files (opt-outs + generate declarations) + `javascript.installDependencies: false` (**mandatory** — auto-install runs concurrent per-project `bun install`s that resurrect the EEXIST race; one root install is the contract). turbo (spike-verified, config preserved in the spike branch) is the documented fallback | De-risk pass passed: inheritance solves config sprawl, REAPI remote cache round-trips against bazel-remote, outputs hydrate, Rust joins the graph shim-free |
| 4 | Root scripts become `moon run :<task>` (capped `-c`); **delete `scripts/run-package-script.ts` AND the umbrella packages' `--filter` fan-out scripts** (see incident) | Replaces unbounded fan-out (jetsam/fork-bomb class) with cached, bounded, dependency-ordered runs |
| 5 | **Separate `generate` from `typecheck`/`test` in package scripts** (e.g. birmel `typecheck` is currently `bun run generate && tsc --noEmit`) | Task purity → correct caching; turbo handles ordering via `dependsOn` |
| 6 | `.turbo` added to root `.gitignore` in the same PR that adds turbo | Unignored turbo logs self-invalidate every task hash (spike-proven) |
| 7 | **Never `turbo prune`**; Docker builds use plain `bun install` | Recurring bun.lock corruption upstream |
| 8 | Bun stays **1.3.x** until turbo supports lockfileVersion 2 | Turbo cannot parse bun 1.4 lockfiles at all |
| 9 | Remote cache = **bazel-remote (REAPI)** self-hosted on the homelab k8s cluster, S3 backend (R2 primary vs SeaweedFS — open question; bazel-remote's S3 backend is MinIO-tested, needs a round-trip against the chosen store) — separate follow-up phase | Round-trip verified locally this session ("cached from remote, 1ms"); also covers moon's lack of local cross-worktree cache sharing |
| 10 | **Skip bun catalogs** for now; shared versions stay per-package (Renovate keeps them aligned) | Renovate cannot update `catalog:` entries (2026); catalogs also trigger the worst isolated-linker bug (#23615) |
| 11 | Root fan-out happens **only through turbo** (`--concurrency` capped); `bun run --filter '*'` is banned in scripts/docs | bun `--filter` has no concurrency cap (open request #27858) — the jetsam-freeze class |
| 12 | Add `trustedDependencies` for `prisma`/`@prisma/client`/`@prisma/engines` at root if missing; keep explicit `generate` tasks | Postinstall gating under workspaces; explicit generate sidesteps install-order coupling |
| 13 | Runner choice stays reversible: all tasks remain plain package.json scripts; runner-specific files are `.moon/**` + ~17 small `moon.yml`s | turbo config is preserved on the spike branch; switching back is an afternoon, not a migration |

## Phases

**Phase 0 — prereqs (in flight).** Merge #1516 (CI removal), then #1517 (setup.ts removal).

**Phase 1 — land the workspace.** Refresh #1408: merge current main (the spike's conflict map: `.dagger/*` + `scripts/ci/*` + `setup.ts` resolve as deleted; per-package `bun.lock`s resolve as deleted; a handful of package.json version-bump overlaps need real resolution + `bun install` lockfile reconcile). Local verification sweep via turbo (Phase 2 tooling can be used pre-merge in the worktree): `turbo run build typecheck test lint` package-by-package, fix fallout. This is the highest-risk phase — it touches all 45 members.

**Phase 2 — land the task graph.** Add `packageManager: "bun@1.3.14"`, `turbo` devDep (pinned), `turbo.json`, `.turbo` gitignore; de-chain `generate` from check scripts across packages; rewrite root scripts to `turbo run`; delete `run-package-script.ts`; update AGENTS.md ("Development Setup" becomes: `mise trust -y --all && mise install && bun install && bunx turbo run build typecheck --affected`), worktree-workflow skill, and the machine-safety guidance (root runs are now safe: cached + bounded).

**Phase 3 — remote cache (follow-up session).** Deploy ducktors/turborepo-remote-cache to the cluster (cdk8s app), R2 bucket via tofu, `TURBO_API`/`TURBO_TOKEN`/`TURBO_TEAM` wiring (1Password), verify push/pull round-trip. Unblocks future CI (Layer 3) reusing the same cache.

## Risks

| Risk | Mitigation |
| --- | --- |
| #1408 is 100 files and 8 days stale vs main | Spike already produced the conflict map; mechanical except a few package.json unions |
| Per-package breakage only surfaces on the full sweep (old CI was the verifier) | Turbo makes the sweep cheap: run it package-by-package in the worktree pre-merge; cache means re-runs are free |
| Isolated-linker unknowns at daily-driver scale (EEXIST memory was real once) | It was a multi-install race (per-package installs + shared cache); single root install removes the concurrency. Escape hatch: `linker = "hoisted"` in bunfig is a one-line revert |
| bun 1.4 auto-bump breaks turbo silently | Pin + notify-only Renovate annotation on the bun version |
| npm-published packages (webring, astro-og, eslint-config) with `workspace:*` deps | Verified in spike: `bun pm pack` rewrites `workspace:*` to the concrete version |

## Open questions (for user)

1. Land #1408 under its own PR (original session's authorship) or re-cut from the spike branch? Spike branch `spike/workspace-taskgraph` already contains the merged result.
2. ~~Adopt bun `catalog:`?~~ Resolved → skip for now (Renovate can't update catalogs; Design decision 10).
3. Phase 3 store: confirm R2-primary (needs a Cloudflare bucket + token — will ask before creating any external resource) vs SeaweedFS-only (no new external resource, but tailnet/homelab-availability-coupled).
4. Linker: plan keeps #1408's isolated (spike-verified on 1.3.14) over the research agent's hoisted recommendation — veto here if you'd rather start conservative; it's a one-line bunfig change either way.

## Session Log — 2026-07-12

### Done

- Scanned repo for CI remnants; confirmed Dagger fully gone from source (cluster still holds an orphaned `dagger` namespace + 2 Ti PVC — user chose to leave as-is; Buildkite infra intentionally kept).
- **PR #1517** (stacked on #1516): removed `scripts/setup.ts`, `.mise.toml` dev/install tasks, the setup.ts eslint grandfather block; rewrote root AGENTS.md Development Setup + worktree section; updated `worktree-workflow` skill (chezmoi source + live copy), both SessionStart hooks, `packages/{discord-plays-core,streambot}/AGENTS.md`, `bot-clone.ts` comment.
- Investigation: found open **PR #1408** = complete Layer-1 workspace migration, stranded when its verifier (Buildkite) was removed.
- Spike (`spike/workspace-taskgraph` = #1408 + rip-setup merged): install 5,817 pkgs/6.3 s clean, node_modules 4.0 G (vs 13–15 G), workspace symlinks kill stale-dist class, Prisma green (generate/typecheck/runtime resolution) under isolated linker on bun 1.3.14, turbo 2.10.4 caching stable after `.turbo` gitignore (FULL TURBO 73 ms), `--affected` exact, `bun pm pack` rewrites `workspace:*`.
- Three research reports (turbo+bun, moon/alternatives, bun-workspace maturity) folded in above.
- This plan authored and shipped on the #1517 branch.

### Remaining

- User review of this plan + the 3 open questions (land-#1408-vs-recut, R2 vs SeaweedFS, isolated-vs-hoisted veto).
- Phase 1: refresh #1408 against post-#1516/#1517 main (conflict map captured above) and run the full turbo sweep locally before merge.
- Phase 2: turbo landing (turbo.json, de-chain generate scripts, root script rewrite, delete `run-package-script.ts`, docs/skill updates).
- Phase 3 (follow-up session): remote cache deploy.

### Caveats

- Moon PoC (2026-07-12, later in session): both runners verified head-to-head on the spike branch — see "Head-to-head PoC" section; runner decision now explicitly with the user.
- Spike branch `spike/workspace-taskgraph` exists as a local worktree (`.claude/worktrees/spike-ws`), not pushed; it contains mechanical ours-side conflict resolutions (slightly stale main-side dep bumps) — fine for evidence, not for landing as-is.
- Turbo cache instability will recur for any task whose script mutates tracked files non-deterministically; `.turbo` gitignore fixed the observed case but Phase 2 should audit `generate`-style scripts.
- **Hold bun at 1.3.x** until turbo supports lockfileVersion 2 (turbo discussion #13126) — a Renovate bun bump to 1.4 would silently break turbo's workspace graph.
- The bun-ws research agent recommends hoisted linker; this plan overrides with spike evidence — if Phase 1's full sweep surfaces isolated-linker weirdness, flip to hoisted immediately rather than debugging forward.
