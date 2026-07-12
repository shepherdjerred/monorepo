# CI Replatform: Dagger Exit, Relevant-Work-Only, Off-Cluster Option

## Status

In Progress (direction approved by owner 2026-07-11; no implementation started)

## Decision summary

| #   | Decision               | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Build execution        | Plain Buildkite steps in digest-pinned images; `docker buildx` for images (per-job rootless buildkitd, **never a PVC**)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2   | Pipeline orchestration | **Keep `scripts/ci` generator** + change detection (validated as the mainstream pattern; see research report)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | Caching                | Stateless only, **located adjacent to compute** (caches follow the builders): while builders are on-cluster → SeaweedFS; if Phase D moves builders off-cluster → R2 (zero-egress; Zed precedent) or Depot Cache. Mechanism: buildx `--cache-to type=s3` (lifecycle expiry, per-package cache refs); sccache→S3 (Rust); keyed tarballs via Buildkite cache plugin (Bun, Go fallback); Go `GOCACHEPROG` when a self-hosted backend matures. Caches are soft state — relocation = endpoint repoint + warm build, no migration. Nightly **no-cache canary build** against silent-stale keys |
| 4   | Registry               | Zot (online refcount GC) if registry-side cache/output retention needed; never registry:2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | Work reduction         | Over-invalidation audit + two-tier pipeline (fast per-push, heavy at merge/label)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | Topology               | Hybrid off-cluster CI is the end-state option: heavy tier on hosted agents (Buildkite hosted/Namespace, or Depot), small on-cluster queue for deploy steps (tofu/Argo/helm need cluster access)                                                                                                                                                                                                                                                                                                                                                                                         |
| 7   | Explicitly rejected    | moon/Nx/Turborepo (replace working generator; Turbo incompatible with per-pkg lockfiles), Nix build substrate (stateful store, Swift/Tauri gaps), CAS newcomers (bus-factor-1 pre-1.0), Bazel-class graphs, repo splitting, node autoscaling                                                                                                                                                                                                                                                                                                                                            |

Full evidence: `~/.claude-extra/research/monorepo-build-system-landscape.md` (in recall) and
`packages/docs/logs/2026-07-11_build-tooling-step-back-assessment.md`.

## Why (one paragraph)

Both outage cycles (2026-02 load-587; 2026-06/07 EDQUOT) share one mechanism: concurrent
build traffic × a shared stateful engine on the node that also runs production services.
Normal agent-driven development is inherently concurrent, and 22% of commits currently
full-fan-out (~180 jobs). Fix = remove the stateful engine (concurrency then degrades to
queueing, not deadlock), do only relevant work per push, and optionally move heavy CI off
the prod node entirely (blast-radius decoupling).

## Phases (each makes the next cheaper)

### Phase A — Do only relevant work (scripts/ci only, no infra risk)

- [ ] Over-invalidation audit round 2 (predecessor: `decisions/2026-04-26_ci-build-scoping-fixes.md`):
      re-audit `classifyRenovateFiles` + `checkInfraChanges` (`scripts/ci/src/change-detection.ts`);
      quantify true full-build rate vs the 22% heuristic (Buildkite job counts); fix
      unrelated-files-in-squash-merge contamination widening affected sets
- [ ] Two-tier pipeline: per-push = affected lint/typecheck/test only; heavy tier
      (image builds, homelab synth/helm/tofu-plan, `--source .` cross-cutting steps) at
      merge to main or explicit label/`[full-ci]` trigger
- [ ] Verify superseded-build auto-cancellation on branch pushes (agents repush constantly)
- [ ] Success metric: worst-case concurrent job count and p95 jobs-per-push, before/after

### Phase B — Phase-0 stateless-cache measurement (one session, commits to nothing)

- [ ] On torvalds: build 2-3 representative images twice via buildx `--cache-to/from
type=s3` (SeaweedFS), per-job rootless buildkitd, no PVC
- [ ] Measure: bytes written (node_disk metrics), hit behavior across simulated rebase,
      cold vs warm wall-clock vs current Dagger times
- [ ] Buildkite cache plugin: two concurrent jobs sharing a key on SeaweedFS (retry config)
- [ ] Go/no-go gate for Phase C

### Phase C — Dagger exit (phased, main stays green)

- [ ] Inventory all `.dagger/src/` modules (~20 files); classify each: plain step in
      pinned image / buildx / delete
- [ ] Migrate in order: images → per-package steps → cross-cutting steps (tofu,
      release-please, helm) — cross-cutting last, they carry secrets wiring
- [ ] Add: nightly no-cache canary; Zed-style drift-check that regenerating the pipeline
      yields no diff; PostHog-style fail-if-stale drift-checks on codegen seams
      (Prisma, helm-types, JSON Schema→Zod/Pydantic)
- [ ] Decommission: engine StatefulSet, 2Ti PVC, GC config, Kueue serialization,
      `DaggerEnginePVC*` PrometheusRules, PVC-resize runbook
- [ ] Replace Kueue with simple `concurrency_group` caps sized to the node

### Phase D — Off-cluster hybrid (optional; only after A shrinks minutes)

- [ ] Trial one: Buildkite hosted agents (Namespace-powered) vs Depot (remote container
      builds + Depot Cache) vs Hetzner overflow queue
- [ ] Split queues: heavy build/test off-cluster; small on-cluster queue for deploy
      steps (tofu-apply, Argo, helm push)
- [ ] Caches move WITH the compute (never homelab-hosted caches for off-cluster
      builders — GBs of cache export per build over the home uplink + re-couples CI to
      homelab availability): R2 (zero egress) or Depot Cache; repoint S3 endpoints +
      warm build, no data migration
- [ ] Decision inputs: monthly build-minutes after Phase A × hosted pricing vs
      blast-radius value (CI load can no longer freeze prod services)

## Risks / mitigations

- Silent-stale cache keys → nightly no-cache canary (Phase C, day one)
- buildx k8s driver auto-creating StatefulSet+PVC → per-job rootless buildkitd only;
  hygiene check candidate for `scripts/check-dagger-hygiene.ts` successor
- Cache-tag stomping under concurrency → per-package cache refs
- Hosted-agent secrets/deploy access → deploys stay on-cluster (hybrid), never ship
  cluster creds off-node
- Write-volume assumption wrong → Phase B gate exists precisely for this

## Session Log — 2026-07-11

### Done

- Direction settled with owner: exit Dagger to plain-steps+buildx+stateless caches,
  keep scripts/ci generator, do Phase A work-reduction, evaluate off-cluster hybrid.
- Plan authored (this doc). No code changes yet.

### Remaining

- Execute Phase A (first implementation session; worktree + scripts/ci changes).
- Phases B-D per above.

### Caveats

- Phase B is a hard gate for Phase C — do not bulk-migrate on unvalidated cache design.
- Research report findings are dated 2026-07 and perishable (hosted-agent pricing,
  Bun workspace bugs, moon maturity may shift; re-verify before Phase D).
