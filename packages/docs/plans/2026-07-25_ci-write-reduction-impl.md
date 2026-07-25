---
id: 2026-07-25-ci-write-reduction-impl
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# CI Write Reduction — Implementation (single PR)

## Context

CI writes ~0.8–1 TiB/day (~99% of box writes) onto the torvalds NVMe. Research
in `logs/2026-07-25_ci-efficiency-research.md` + budget in
`plans/2026-07-25_ci-write-reduction-10x.md`. User decisions: one PR with the
write-reduction core PLUS pipeline-shape items; tmpfs on all heavy lanes; hard
buildkitd cutover (no env gate).

Verified pre-conditions (live, 2026-07-25):

- buildkitd Running; `buildkitd-cache` PVC Bound (150Gi, zfs-ssd-lz4); Service
  **`buildkitd-buildkitd-service`** :1234 (the impl-plan recipe and the
  `buildkitd.ts:62` comment both use a wrong DNS — real name above).
- buildkitd internals: 1 replica/Recreate, 500m/1Gi req → 8CPU/12Gi lim, GC
  keepBytes 100GiB, moby/buildkit v0.28.1, **no NetworkPolicy today**.
- agent-stack-k8s v0.45.0 job pods mount a disk-backed emptyDir named
  `workspace`; the chart exposes first-class `config.workspace-volume`
  (full corev1.Volume) that replaces it — the tmpfs patch point (NOT
  podSpecPatch volume merging, which the controller would duplicate).

## Components (stacked commits, one PR)

| #                                          | Change                                                                                                                                                                                                                                                                                                                | Files                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A                                          | Hard cutover to remote buildkitd; fix wrong-DNS comment; NEW NetworkPolicy (ingress :1234 from buildkite ns only)                                                                                                                                                                                                     | `.buildkite/scripts/bake-images.sh:147-149`, `packages/homelab/src/cdk8s/src/resources/buildkitd.ts`                                              |
| B                                          | Lockfile-aware image selection: drop blanket `*/package.json`→ALL; bun.lock closure fingerprint diff (JSONC-tolerant parse; ANY surprise → fail-open ALL); root+scripts package.json stay global                                                                                                                      | `.buildkite/scripts/select-image-targets.ts` + test                                                                                               |
| C                                          | tmpfs workspace for ALL job pods via `config.workspace-volume` (memory-backed emptyDir, sizeLimit 16Gi); raise heavy-anchor mem requests (verify/privileged 2Gi→6Gi/4Gi, light 512Mi→1Gi); Kueue mem quota 20→28Gi                                                                                                    | `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`, `kueue-config.ts` (+ lockstep test), `.buildkite/pipeline.yml` anchors |
| D                                          | PR micro-lane merge: tofu-plan+sites-pr+helm-pr+release-pr+helm-types-drift → one `pr-dryrun` (union if_changed; per-section gating via `CI_CHANGED_BASE=$(git merge-base origin/main HEAD) ci-changed.sh <lane>`; new `release` lane); main: merge npm-publish+cooklang-publish; update validate-pipeline invariants | `.buildkite/pipeline.yml`, `.buildkite/scripts/ci-changed.sh`, `validate-pipeline.ts`                                                             |
| E (descoped → todos/ci-base-digest-pin.md) | ci-base digest pin: push `:v<build#>`; refresh step opens auto-merge bump PR rewriting the pinned tag in pod anchors; `imagePullPolicy: IfNotPresent`                                                                                                                                                                 | `.buildkite/scripts/build-ci-image.sh`, `.buildkite/pipeline.yml`, small bump script                                                              |
| F                                          | Trivy git-mirror volumeMount (copy semgrep's)                                                                                                                                                                                                                                                                         | `.buildkite/pipeline.yml` trivy step                                                                                                              |

Not in this PR: bump debounce (content-gating already bounds it), playwright+bun
image, pod-smoke end state (drop `--load`), shared bun cache (bun#12917), R2
second node.

## Remaining

- [ ] Drive PR #1639's `buildkite/monorepo/pr` green and merge
- [ ] Post-merge: watch first main build (buildkitd bake via the remote
      driver, tmpfs canaries: node MemAvailable > 8Gi + zero evictions,
      ArgoCD sync of buildkite/buildkitd/kueue charts); then run
      `scripts/ci-io-report.ts --enforce-impact-gates`
- [ ] Reporter lane model (`scripts/lib/ci-io-report-model.ts`) predates the
      merged pr-dryrun/publish steps — fixed-corpus comparisons across the
      schema change go inconclusive by design; teach it the new keys when
      the post-merge measurement lands
- [ ] Component E descoped to `todos/ci-base-digest-pin.md` (bump-loop risk
      not worth rushing; smallest write win of the six)

## Verification

1. `bun run verify -- --affected` per branch (selector tests, validate-pipeline,
   kueue lockstep, homelab synth/tests).
2. The PR's own Buildkite build e2e-validates A/B/D/F pre-merge (`.buildkite/**`
   → global closure → images-pr bakes ALL targets through the remote driver).
   C (chart config) and E's refresh activate post-merge via ArgoCD — watch the
   first main build; canaries: node MemAvailable > 8Gi, zero evictions,
   buildkitd PVC/GC behavior, `ci-io-report.ts --enforce-impact-gates`.
3. Rollback per component is a one-line revert (cutover line, workspace-volume
   value, selector fail-open already defaults to ALL).
