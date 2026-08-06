---
id: 2026-07-25-ci-write-reduction-10x
type: plan
status: planned
board: false
---

# CI Write Reduction — Path to 10x

## Context

Post-#1602 CI writes ~0.8–1 TiB/day (SMART; was 4.4 replatform, 3.1 Dagger
era). User goal: **10x down → ≤~90 GiB/day**. Grounded in
prior analysis (this session),
prior analysis,
`plans/2026-07-22_ci-capacity-remediation{,-impl}.md`,
`plans/2026-07-19_ci-io-optimization.md`, `plans/2026-07-18_ci-speed.md`.

Note on "read/write": NVMe wear (TBW) is writes; reads matter via write
amplification (image unpack = writes) and I/O pressure (freeze history).
Every lever below cuts both.

## Verdict

**Yes, but only with the full stack.** Budget model (scripted; class shares
are assumptions from measured pre-change attribution — every phase re-measures
with the existing `scripts/ci-io-report.ts --enforce-impact-gates`):

| Scenario                                               | GiB/day            | Factor                      |
| ------------------------------------------------------ | ------------------ | --------------------------- |
| Today                                                  | ~920               | 1x                          |
| P1+P2+P4 + builds −30%                                 | ~145–210           | 4.4–6.3x                    |
| + tmpfs on checkouts/scanners, misc ×0.25, builds −40% | ~72–97             | **9.5–12.8x**               |
| Backstop: R2 sacrificial CI node (relocation)          | ~0 on the 990 PROs | ∞ for the disks that matter |

## Phases

### P0 — Validate load-bearing assumptions (½ day, no buildout)

- [ ] buildkitd remote-driver smoke: one manual bake against the deployed
      (currently inert) `buildkitd` Service from a CI pod (`bake-images.sh`
      recipe in `plans/2026-07-22_ci-capacity-remediation-impl.md:202-232`).
      Never live-validated — GitOps meant post-merge-only.
- [ ] tmpfs accounting probe: one verify build with an 8Gi memory-backed
      emptyDir for node_modules; confirm Kueue/limit accounting + no eviction.
- [ ] Selector oracle check: replay ~20 historical Renovate/manifest PRs
      through a prototype lockfile-aware selector; compare against real
      workspace closures (bun.lock parse → changed pkgs → owner closure), not
      against the old selector.
- [ ] Re-measure current class shares with the io-reporter (post-#1602 split
      was never captured; the budget's shares are pre-change-derived).

### P1 — Kill the image-write class (1–2 days)

- [ ] buildkitd cutover: `bake-images.sh:148` per-run `docker-container`
      builder → `--driver remote` to the persistent lz4/GC'd store (Track 3.1,
      service already deployed by #1610).
- [ ] Lockfile-aware image selection: replace the ALL-14-targets fallback in
      `select-image-targets.ts:156-163` — parse the bun.lock/manifest diff to
      changed workspaces → owner closures; keep fail-open-to-ALL on parse
      failure. (New lever; in no prior track. Kills the Renovate × 14-bakes
      worst case.)
- [ ] Pod-smoke end state (ci-speed §"pod-smoke"): push `:sha`, smoke via k8s
      pods on prod containerd, drop `--load` (the second copy of every image).
      Can trail the cutover; additive.

### P2 — Make ephemeral writes actually ephemeral (1–2 days)

- [ ] Memory-backed emptyDir for node_modules + turbo scratch on verify and
      playwright pods (sizeLimit ~8Gi; raise those pods' memory requests to
      match — trade against Track-1 concurrency, so verify-class only first).
- [ ] Extend to scanner pods + checkout working trees if P0 probe is clean
      and headroom holds (66 GiB avail measured; 24 GiB peak at 3 concurrent
      tmpfs pods).
- Shared bun cache stays DESCOPED (oven-sh/bun#12917).

### P3 — Cut build/pod frequency (1 day)

- [ ] Version-bump debounce (Track 2.4): bump PR at most every N hours via
      Temporal instead of per main build (~130/300 recent builds are the
      automation loop).
- [ ] Micro-lane merge (Track 2.1): one `pr-dryrun` pod for
      tofu-plan/sites-pr/helm-pr/release-pr/helm-types-drift; merge main
      light lanes similarly (−4–6 pods/build).
- [ ] ci-base digest pin (Track 2.2): drop `imagePullPolicy: Always`.

### P4 — Misc write fixes (½ day)

- [ ] Trivy pod: add the `buildkite-git-mirrors` volumeMount (semgrep has it,
      trivy doesn't — ~1 GB clone per lockfile PR today) + cache the trivy DB.
- [ ] `playwright+bun` derived image (mcr base + bun + warm cache): removes
      per-run apt-get + curl-bun + cold install in both playwright lanes.

### Gate after each phase

`scripts/ci-io-report.ts --enforce-impact-gates` + the Buildkite I/O
dashboard (both already built). If P1–P4 stall short of 10x, the decision
point is the **R2 sacrificial node** (separate WIP; relocation not reduction —
the 990 PROs stop absorbing TBW entirely).

## Risks

| Risk                                                         | Mitigation                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| tmpfs counts against pod memory → fights Track-1 concurrency | verify-class only first; sizeLimit + measured 28Gi request headroom; back off is config-only     |
| buildkitd = shared daemon (mini-Dagger)                      | bounded PVC + GC keepBytes (designed); ghcr buildcache kept as fallback; NetworkPolicy hardening |
| Selector correctness (skips a needed image)                  | fail-open on parse failure; P0 oracle replay; main still content-gates digests                   |
| Budget shares are estimates                                  | P0 re-measures before any buildout claims credit                                                 |
