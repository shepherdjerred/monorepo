---
id: 2026-07-22-ci-capacity-remediation-impl
type: plan
status: in-progress
board: false
---

# CI capacity remediation — implementation plan

## Context

CI on the single homelab node (`torvalds`) is slow and SSD-hostile. Measured
live 2026-07-22:

- **Latency**: last 14d build p50 22m / p90 124m, vs the Dagger era's 7m / 18m.
  Heavy steps wait ~60m (p90) for a pod slot then run in 1.4–7m.
- **Root cause of latency**: Kueue admits **2 concurrent heavy pods**
  (7.5 CPU / 16 Gi quota ÷ 3 CPU / 8 Gi requests) while the node sits at 9% CPU
  with real request headroom of **13.8 cores / 28 GiB** (non-buildkite commits
  only 13.2 CPU / 45 GiB of 27 CPU / 73 GiB allocatable). Pod requests are
  2–4× measured p90 usage (step container p90 0.96 CPU / 1.5 GiB).
- **Writes**: CI writes 0.8–4.4 TiB/day, ~99% of all box writes, mostly onto
  the **xfs `/var`** system partition (dind graph, emptyDir, image layers) —
  Samsung 990 PRO at 12% of rated TBW, ~1.6–3.9yr to exhaustion at recent pace.
- **Key correction**: `/var` is **xfs, not ZFS**, so ZFS `lz4` compression
  cannot touch today's storm — its payoff comes only once Track 3 **relocates**
  the big writers onto compressed ZFS PVCs.

Goal: same capabilities, much lower latency and SSD wear. Decisions taken:
**one bundled PR** (tracks built incrementally, merged together);
**conservative** quota target. R1 (hosted CI) rejected; R2 (second node) is a
separate WIP; R3 (merge queue) deferred.

Full evidence: `packages/docs/logs/2026-07-22_ci-capacity-analysis.md` +
`packages/docs/plans/2026-07-22_ci-capacity-remediation.md`.

---

## Track 1 — Concurrency (config-only, immediate relief)

**Raise admission to the measured headroom; shrink requests to measured usage.**

1. **`packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts:18`**
   — `BUILDKITE_MAX_IN_FLIGHT = 10` → `20`. This single constant flows into the
   Kueue `pods` quota (imported at `kueue-config.ts:64`); the lockstep test
   (`kueue-config.test.ts:65-75`) stays green automatically.
2. **`packages/homelab/src/cdk8s/src/resources/kueue-config.ts:56,60`** — cpu
   `7500m` → `12000m`, memory `16Gi` → `20Gi`. Replace the stale header comment
   (lines 8-20; it claims "~2.5 cores headroom" — false today) with the live
   13.8 CPU / 28 GiB headroom figure and the conservative-margin rationale.
3. **`.buildkite/pipeline.yml` pod anchors — right-size _requests_, leave limits
   (bursting) unchanged**:
   - `*pod` base (`:40`): `cpu 2 / memory 4Gi` → `cpu 1 / memory 2Gi`
   - `*pod_privileged` (`:71`) container-0: `cpu 2 / memory 6Gi` → `cpu 1 / memory 2Gi`;
     dind (`:104`): `cpu 1 / memory 2Gi` → `cpu 750m / memory 1536Mi`
   - `*pod_light` (`:126`): `500m / 1Gi` → `250m / 512Mi`
   - Every new request is ≥ measured p90 usage, so pods won't OOM/CPU-starve.
   - Net: a heavy privileged pod costs ~1.75 CPU / 3.5 GiB of admission →
     **~6 concurrent heavy pods** (was 2), bounded by pods=20 for light steps.
4. **Buildkite pipeline "skip/cancel intermediate builds" for non-main
   branches.** First confirm where the pipeline is defined — the `buildkite`
   tofu stack exists (`src/tofu/`, applied by the tofu-apply step); set it there,
   **not** the UI (UI edits don't stick under GitOps). If the pipeline object
   isn't tofu-managed, flag to the user rather than clicking the UI.

Expected: wait p90 ~60m → single digits; build p50 22m → ~8–10m (bounded by the
longest real step, not the queue).

---

## Track 2 — Shrink per-build work

1. **Consolidate PR micro-lanes.** `tofu-plan`, `sites-pr`, `helm-pr`,
   `release-pr`, `helm-types-drift-check` each spawn a pod + full checkout +
   filtered install to do seconds of work. Merge into **one `pr-dryrun` step**
   running them sequentially in a single pod. Files: `.buildkite/pipeline.yml`,
   plus update `.buildkite/scripts/validate-pipeline.ts` (step-key/pod
   attribution invariant) and `ci-changed.sh` lane mapping. Keep the `if_changed`
   union of all merged lanes' paths so nothing over/under-runs. (Main-only
   micro-lanes have distinct `depends_on`/concurrency groups — leave for now.)
2. **Digest-pin `ci-base`; drop `imagePullPolicy: Always`.** Tag the refresh
   output with an immutable per-content tag and pin the three pod anchors to it,
   switching to `IfNotPresent` — eliminates the fleet-wide re-pull + per-pod
   manifest check that `:latest`+`Always` forces (`pipeline.yml:28-32`, `:60-63`,
   `:120-122`; `build-ci-image.sh`). Handle the same-build bootstrap (the build
   that refreshes the image still runs its other pods on the prior pin) — pin
   moves via a commit-back, like `version-commit-back`. Scope carefully.
3. **ZFS `compression=lz4`.** Set `compression: "lz4"` in
   `storage-classes.ts:24,42` (new volumes) **and** `zfs set compression=lz4
zfspv-pool-nvme zfspv-pool-hdd` live (existing datasets, applies to new
   writes). Reframed: helps only ZFS-backed writes (git-mirrors + Track 3
   caches), **not** the xfs `/var` storm — its real value lands with Track 3's
   relocation. Cheap, so do it now.
4. **Ephemeral-storage requests/limits** on step + dind containers
   (`pipeline.yml` anchors), e.g. requests 2Gi / limits 40Gi — a runaway build
   can no longer fill `/var` and wedge the node (freeze protection; there are
   none today).
5. **Debounce the version-bump loop.** `version-commit-back` opens/refreshes a
   bump PR every main build → ~10–20 self-triggered builds/day. Coalesce
   (open/update at most every N hours, or move to a Temporal schedule).
   `scripts/update-versions.ts` + the `version-commit-back` step. Own sub-task.

---

## Track 3 — Bounded persistence (restores Dagger-era speed, without the freeze)

The Dagger history is the design proof: persistent cache = p50 7m CI; what
killed it was **unboundedness** on the node's critical path. These caches are
fixed-size, GC'd, single-purpose, and off the step critical path.

1. **Persistent `buildkitd`.** New service per homelab conventions (AGENTS.md
   "Adding New Services"): cdk8s chart `src/cdk8s/src/cdk8s-charts/buildkitd.ts`,
   helm dir `src/cdk8s/helm/buildkitd/`, ArgoCD app
   `src/resources/argo-applications/buildkitd.ts`, registered in
   `setup-charts.ts` / `apps.ts`; image pinned in `versions.ts`. Follow the
   `turbo-cache.ts` Deployment+Service pattern and the `KubePersistentVolumeClaim`
   pattern at `buildkite.ts:91`. Deployment runs `moby/buildkit`, PVC
   `/var/lib/buildkit` on **zfs-ssd (lz4)** ~150Gi, GC configured
   (`gckeepstorage≈100GB`), Service `tcp://buildkitd.buildkite.svc:1234`.
   Then in **`.buildkite/scripts/bake-images.sh:147-149`** replace the per-run
   `docker buildx create --driver docker-container` with a `--driver remote`
   builder pointed at the Service (keep ghcr registry cache-from/to as fallback).
   `--load` still pulls the final image into dind for smoke. Result: the bulk of
   dind's ~3.8 TiB/wk build-layer writes move onto compressed ZFS; `images`
   21–43m → a few minutes warm.
2. **Shared bun install cache.** New RWX PVC `buildkite-bun-cache` on zfs-ssd
   (lz4), mounted into step container-0 via the agent-stack `pod-spec-patch`
   volume+volumeMount (`buildkite.ts:150-199`), with `BUN_INSTALL_CACHE_DIR`
   pointed at it. Installs hardlink from cache instead of re-downloading → large
   cut in per-pod writes + install time. Validate concurrent-writer safety of
   bun's content-addressed store under parallel installs before relying on it.
3. **(Deferred)** tmpfs `emptyDir{medium: Memory}` for `node_modules` on
   `verify` — only after Track 1 proves memory headroom holds under load.

---

## Verification

- **Build/test**: `bun run verify` (homelab `check:talos`, `lint:helm`,
  `check:1password`, and `kueue-config.test.ts` all green). New buildkitd chart
  passes `helm-template.test.ts` / `argocd-helm-render.test.ts`.
- **Deploy**: GitOps only — merge to main → ArgoCD syncs. Confirm buildkitd pod
  Ready + PVC Bound; confirm CI pods schedule at the new quota (no `Pending`
  storms — the failure mode the old comment warned of).
- **Latency**: rerun the wait/run p50/p90 queries from the analysis log after a
  day of traffic; target build p50 ≤ 10m, wait p90 single digits.
- **Writes**: `scripts/ci-io-report.ts --enforce-impact-gates` (already built for
  exactly this) — confirm per-job write bytes drop; re-check nvme0n1 daily GiB.
- **Freeze canaries (must stay quiet a week)**: node `MemAvailable` above the
  8 GiB soft-eviction floor, zero eviction events, `ZfsArcHitRateLow` silent.
- **Rollback**: Track 1 = revert one constant + the quota values; Track 3 =
  revert `bake-images.sh` to the per-job builder (buildkitd is additive).

## Sequencing within the one PR

Build incrementally in a worktree: Track 1 first (lands the relief and is the
low-risk core), then Track 2, then Track 3; open one PR with all of it. Watch
the freeze canaries through the whole rollout; if any fire, the quota constant is
a one-line back-off.
