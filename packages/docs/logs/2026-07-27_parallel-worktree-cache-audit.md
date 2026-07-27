---
id: parallel-worktree-cache-audit-2026-07-27
type: log
status: complete
board: false
---

# Parallel worktree cache audit

Read-only audit of development and CI cache behavior for parallel monorepo worktrees.

## Findings

- Turbo has local worktree caches and an authenticated remote cache service backed by a 256 GiB local NVMe PVC on Liskov, not R2. A developer worktree benefits from it only when its environment supplies the tailnet URL, team, and token.
- Bun uses the isolated linker. The repository intentionally does not enable Bun's experimental shared global store because concurrent CI installs have a known safety issue; a developer can opt into it in `~/.bunfig.toml`.
- Rust has no repository `CARGO_TARGET_DIR` or `sccache` configuration, so its compilation output stays per worktree while Cargo's registry download cache remains user-global.
- The repository-wide Python pyright environment is `.venv` at the worktree root. It is intentionally isolated, while uv's download cache is user-global.
- Docker Bake reads per-image registry build caches locally and writes them only from main CI. Local Docker/BuildKit layer caching is also builder-global on the developer machine.
- Cross-repository gates are Turbo tasks with explicit input scopes. Their cached results are safe to share through the configured authenticated on-disk Turbo cache; broad checks retain intentionally broad invalidation inputs.

## CI cache coverage

- High-value shared CI inputs are covered: Git objects use a 20 GiB mirror, Bun packages use a 30 GiB content-addressed download cache, Turbo task outputs use a 256 GiB on-disk service, OpenTofu providers use a locked 10 GiB cache, and BuildKit retains 240 GiB from a 300 GiB cache PVC. Docker also reads and, on main, exports GHCR build-cache refs.
- Per-pod `node_modules`, worktrees, and the isolated-linker global store intentionally remain uncached. Sharing them would reintroduce the known concurrent Bun global-store hazard and undermine per-job isolation.
- The remaining practical download-cache gaps are uv's Python package cache and Trivy's vulnerability database. Both are recreated in otherwise ephemeral pods when their Turbo or scanner lanes run.
- Playwright browsers are supplied by the version-pinned Playwright image; its remaining repeated work is the apt and Bun bootstrap. A derived Playwright-plus-Bun image is preferable to another mutable cache volume.
- Cargo and Go compilation are not a general CI cache gap: Docker builds already reuse BuildKit layers, and the Scout desktop verify path currently runs formatting but not a general Rust compilation/test lane. Add `sccache` or Go module/build caches only if a newly enabled non-container build is measured to be material.
- The larger Turbo improvement is cache effectiveness, not capacity: package tasks have no narrower input declarations, so documentation-only package changes can invalidate their task hashes. Cache-hit counts should be captured before changing the task hashes.

## Session Log — 2026-07-27

### Done

- Audited `bunfig.toml`, `turbo.json`, `docker-bake.hcl`, Buildkite cache wiring, the on-disk Turbo cache deployment, and the active Rust and Python tooling paths.
- Identified the worktree-local versus machine- or CI-shared caches and their concurrency constraints.

### Remaining

- [ ] If desired, add a documented developer remote-Turbo bootstrap and benchmark cache hit rates across fresh worktrees.
- [ ] If Rust desktop builds become a frequent parallel-worktree workload, design a shared `sccache` setup without sharing Cargo `target` directories.
- [ ] Measure Turbo hit/miss counts, then consider a bounded shared uv cache and a freshness-preserving Trivy database cache.
- [ ] Consider a derived Playwright-plus-Bun image to remove repeated apt and Bun bootstrap work.

### Caveats

- The main checkout already contained unrelated untracked session logs; this audit did not modify them.
- No cache configuration was changed.
- The Buildkite pipeline comment calling the Turbo cache "R2-backed" is stale; the deployed cdk8s definition selects its local filesystem backend and mounts `/cache` from `turbo-cache-liskov`.
- Cache additions require an independent before/after measurement; static coverage alone does not establish that a cache is on the critical path.
