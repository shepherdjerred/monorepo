# CI Replatform v2: Dagger Exit — Plain Buildkite Steps + buildx + Stateless Caches

## Status

In Progress — **approved by owner 2026-07-12** for compressed (single-session-driven)
execution, triggered by the third distinct engine outage mechanism (cgroup OOMKill →
unclean shutdown → full dagql/cache wipe, on top of the earlier GC/disk-full and
probe-kill-spiral incidents). Owner decisions as of 2026-07-12:

- **Buildkite stays** (only the Dagger layer is replaced); **affected-only builds stay**.
- **Cache store = Cloudflare R2, not SeaweedFS** (changed 2026-07-12; supersedes the
  SeaweedFS bucket design below). This deletes the shared-fate risk with prod sites and
  most of Phase B's isolation-design work; adds WAN latency to cache round-trips
  (measure in Phase B) and R2 credentials as a CI secret.
- **PR #1408 (single Bun workspace) merges FIRST** (owner decision 2026-07-12,
  supersedes the "decoupled tracks" framing below): fix conflicts, merge to main, then
  start C0. The migration then targets the single-workspace world only
  (`prepare-package.ts` ≈ one root `bun install`; no file:-dep staleness class).
- Compute stays on the homelab node (unchanged); exit triggers below still apply.
- C5's deletion sweep still waits for the soak week — scale-to-0 is the in-session
  endpoint; deleting `.dagger/`, the STS/PVC, and the ZFS volume is not.

## Decision summary

| #   | Decision       | Choice                                                                                                                                                                                                                                                                                                      |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Build steps    | Plain Buildkite steps in digest-pinned images (default: `ci-base` + go/argocd/buildctl/docker-cli additions); per-class derived images only where needed (`ci-playwright`, `ci-rust`)                                                                                                                       |
| 2   | Image builds   | `docker buildx bake` against a per-job **rootless buildkitd sidecar, state in emptyDir, never a PVC**; one Dockerfile per image in its package dir + root `docker-bake.hcl`; ghcr.io stays the registry (no Zot initially)                                                                                  |
| 3   | Orchestration  | Keep `scripts/ci` generator + change detection; steps/\*.ts keep keys/deps/gating, only command payloads change (`daggerStep` → `commandStep`)                                                                                                                                                              |
| 4   | Source arrival | Re-enable agent-stack-k8s checkout (`--depth=1`) + existing `buildkite-git-mirrors` 20Gi PVC as alternates (**keep** that PVC — it's a git mirror, not build-cache state). Sparse checkout = later optimization                                                                                             |
| 5   | Caching        | Stateless S3 only: buildx `type=s3` → **Cloudflare R2 bucket** (2026-07-12 decision; dedicated, lifecycle-expired, `ignore-error=true`, per-image `name=` refs); **bun global install cache** (never node_modules tarballs) via Buildkite cache plugin; sccache→R2 (Rust); GOMODCACHE/GOCACHE tarballs (Go) |
| 6   | Smoke tests    | dind sidecar (ns is already PSA-privileged) runs the **real image + real entrypoint** via `bake --load` (cache replay); Bun harness ports `runSmokeTest`                                                                                                                                                    |
| 7   | Compute        | **Stay on the homelab node** (recommendation, evidence below); design stays relocatable (S3 endpoints are constants; step emitters take a queue knob)                                                                                                                                                       |
| 8   | Concurrency    | `max-in-flight: 10` stays; Kueue → plain Buildkite `concurrency_group` caps after cutover (Kueue serves only Buildkite CI — verified `kueue-config.ts`)                                                                                                                                                     |
| 9   | Bun layout     | **#1408 merges first** (owner, 2026-07-12): conflicts fixed and merged to main before C0. Migration targets the single-workspace layout only                                                                                                                                                                |

## Why (unchanged from v1, evidence intact)

Both outage cycles (2026-02 load-587, PagerDuty #3042; 2026-06/07 EDQUOT + disk-full;
2026-07-10/11 restart loop that evicted 1.2Ti of cache) share one mechanism: concurrent
build traffic × a shared **stateful engine** on the node that also runs production
services. CPU/RAM never failed; the stateful cache dataset did (`decisions/2026-06-07_dagger-gc-and-pvc-drift.md`,
`logs/2026-07-03_dagger-engine-disk-full-outage.md`, `logs/2026-07-11_afternoon-dagger-restart-loop.md`).
Plus ~330 commits touching `.dagger/` in 8 months and a local-dev story (`dagger call`)
nobody uses (verified: no package.json/mise/lefthook task invokes dagger locally).
Removing the engine turns overload into queueing instead of deadlock; caches become soft
state with S3 lifecycle expiry instead of GC babysitting.

## Compute location — recommendation: stay on homelab, with explicit exit triggers

Evidence for staying: (a) every incident was the stateful dataset, not compute — the node
(32c/128GB) has headroom; (b) post-exit worst-case checkout+build write pressure ≈ 47
MiB/s vs the 449 MiB/s saturation point measured pre-git-URL-refactor (~10× headroom,
math in session notes); (c) Buildkite hosted agents cost real money against an unmeasured
build-minute volume; (d) deploy steps (tofu/argocd/helm/SeaweedFS) must stay
cluster-reachable regardless.

Revisit and move the heavy tier off-node if ANY of: CI-attributed node pressure incident
recurs post-decommission; measured build-minutes × hosted pricing is trivial for the
value; or a burst-heavy workload (image fan-out) keeps tripping ephemeral-storage alerts.
The design keeps that move config-sized: repoint S3 cache endpoints (SeaweedFS → R2) +
split queues (heavy hosted, deploy on-cluster) + warm build. No data migration — caches
are soft state.

## Interaction with PR #1408 (Bun single-workspace migration) — sequencing constraint

> **2026-07-12 owner decision:** #1408 merges first — conflicts fixed, merged to main,
> then C0 begins. The analysis below is preserved for context; its "preferred order"
> conclusion is now the executed order. The lockfile-aware change-detection prerequisite
> is acknowledged as a live gap during the merge-to-exit window (every root `bun.lock`
> bump = full build until the exit lands); mitigated by executing the exit immediately
> after rather than weeks later.

PR #1408 (open, active, 100 files, PoC-validated; `plans/2026-07-04_bun-workspace-migration.md`)
converts the repo to a single root workspace and **touches 10 `.dagger/src` files**.

- **Hard prerequisite for #1408, independent of this plan:** lockfile-aware change
  detection. Today `change-detection.ts` treats root `bun.lock` as a full-build trigger;
  under one root lockfile **every Renovate bump becomes a ~155-step full build** — a
  Renovate rebase wave then reproduces the July-3 write-storm mechanism through the
  still-running Dagger engine. Ship bun.lock-diff → affected-workspace-member scoping
  (and Renovate classification for the single-lockfile world) before or with #1408.
- **Preferred order:** land #1408 first (it's alive now; blocking it weeks on a replatform
  is worse), accept its `.dagger` changes as sunk work that dies in Phase C5. A
  post-#1408 world also simplifies this plan: `prepare-package.ts` becomes ~one root
  `bun install`, and the file:-dep staleness class disappears (workspace:\* edges).
- If #1408 stalls, this migration proceeds layout-agnostically (per-package installs work
  under coexistence).

## Phases

Engine keeps serving unmigrated `dagger call` steps throughout; both checkout styles
already coexist today. Every PR is independently revertible (generator emits dagger or
plain per category). **Hard cutover per category** — no shadow-running (it doubles load on
the node being protected; Phase B is the validation instead). Oracles: the checks
themselves, smoke tests, and `DRYRUN_FLAG` parity on PRs — never comparison against
Dagger output.

### Phase A (parallel pre-work, cheap)

- Verify superseded-build auto-cancellation actually works (matters more post-exit:
  main-merge wall time grows without cross-build memoization).
- Over-invalidation audit round 2 (`classifyRenovateFiles`, squash-merge contamination) —
  reduces the full-fan-out tax the migration PRs themselves will pay.

### Phase B — measurement + mechanism validation (1 session, HARD GATE, commits to nothing)

On torvalds: bake temporal-worker + discord-plays-pokemon + birmel twice via rootless
buildkitd + `--cache-to type=s3`:

- Bytes written (node_disk metrics) cold/warm; wall-clock vs current Dagger times.
- **R2 cache bucket** (2026-07-12: replaces the SeaweedFS isolation design, deleting
  the shared-fate risk with prod sites): create dedicated R2 bucket + lifecycle rule
  via tofu (Cloudflare provider); `ignore-error=true` so cache failure degrades to
  cache-miss; verify WAN round-trip latency keeps warm builds meaningfully faster than
  cold (R2 has zero egress fees; cost = storage + ops, trivial at cache scale). R2
  access key lands in `buildkite-ci-secrets`.
- Buildkite cache plugin: two concurrent jobs sharing a key (last-writer-wins full PUTs
  expected — verify multipart-PUT atomicity on SeaweedFS).
- Rootless buildkitd viability under PSA (fallback if it fights: per-job **root**
  buildkitd, still ephemeral, still no PVC — "per-job + never-a-PVC" is the load-bearing
  part, not rootlessness).
- dind smoke-test pattern on one image (real entrypoint).
- Shallow-checkout size/time with git-mirrors alternates.
- Go/no-go + tier sizing numbers for Phase C.

### Phase C — the exit (~9-11 PRs, ~9-12 sessions)

- **C0 (tiny PR):** relocate `.dagger/src/deps.ts` → `scripts/ci/src/lib/workspace-deps.ts`
  (4 generator files import across the `.dagger` boundary today: per-package.ts:29,
  images.ts:29, sites.ts:27, helm.ts:22; `scripts/generate-deps.ts` path updated).
  Note: `lib/validate-catalog.ts:164` also reads `.dagger/src/constants.ts` at generation
  time (Playwright pin cross-check) — that read relocates in the same PR that moves the
  Playwright pin, before constants.ts dies at C5.
  `constants.ts` is NOT bulk-relocated — each of its ~25 pins moves in the PR that
  migrates its consumer (image FROMs → package Dockerfiles, tool versions → ci-base
  Dockerfile ARGs, pod images → `lib/step-images.ts`), updating `renovate.json`
  `managerFilePatterns` in the same PR. Invariant to hold at every commit: **every pin
  has exactly one Renovate-managed home** (verify the next Renovate run after each move —
  silent staleness has no red build).
- **C1 (1 PR):** `commandStep()` in lib/buildkite.ts, checkout un-skip in k8s-plugin.ts,
  ci-base additions (go, argocd, buildctl, docker-cli/buildx, claude-code) + digest pin,
  `scripts/ci-steps/prepare-package.ts` + `run-package-checks.ts`, hygiene/eslint wiring
  for `scripts/ci-steps/`. Guinea pigs: soft-fail bundle + toolkit pkg-check.
  **Re-tier every migrated step explicitly** — compute moves from engine into pods;
  relying on the namespace LimitRange default (400m/768Mi, buildkite.ts:64-76) is a bug.
  Add ephemeral-storage requests/limits per tier (nothing sets them today).
  **Bump the Kueue ClusterQueue quota (7.5 CPU/16Gi) alongside re-tiering** — honest
  requests against the unchanged quota would throttle migrated steps to ~3-7 concurrent
  during C1-C4 coexistence. ci-base **keeps the dagger CLI** through C1-C4 (unmigrated
  steps still `dagger call`).
- **C2 (3 PRs):** images. C2a: docker-bake.hcl + sidecar podSpec helpers + tofu'd cache
  bucket + 4 infra images (caddy-s3proxy, obsidian-headless, mcp-gateway, redlib) +
  smokes/pushes + **nightly no-cache canary lands here, day one**. C2b: 6 standard app
  images. C2c: scout/dpp/dpmk (WASM multi-stage) + ci-base into bake + digest metadata
  (`--metadata-file`) into version-commit-back. Image-build `concurrency_group` cap 2-3.
- **C3 (2 PRs):** all per-package checks + contract test (plain step — it spawns the
  server as a subprocess, no container runtime needed) + ios-native-deps; then quality
  bundle (15 scripts, one pod, one checkout) + scanners + homelab checks. Delete
  `.dagger/src/java.ts` outright (zero pipeline consumers — verified).
- **C4 (2 PRs):** sites/npm/helm-push-all/tofu/argocd (dryrun-validated on a PR first,
  then cutover one per main merge), then release-please + commit-backs + cooklang.
  Secrets: no k8s changes — everything already lands in pod env via
  `buildkite-ci-secrets`; GitHub App tokens minted in-pod via
  `packages/temporal/src/lib/github-app-token.ts` (the greptile step already does this —
  quality.ts:185). Relocate `.dagger/prompts/refine-release-please.md` with this PR.
- **C5 (1-2 PRs):** engine STS scaled to 0 for a **soak week** (rollback = scale back up,
  warm cache intact), gated by a rendered-pipeline grep showing zero `dagger` hits over N
  consecutive green main builds. Then delete (after the soak week — the soak IS the
  belt): `.dagger/`, `dagger.json`, lefthook dagger blocks, homelab `dagger.ts`
  (STS/PVC/GC/probe config), `DaggerEnginePVC*` alerts, kueue.ts + kueue-config.ts
  (+ quota==max-in-flight test) → `concurrency_group` caps, the dagger CLI + its
  Renovate-tracked `DAGGER_VERSION` ARG in `.buildkite/ci-image/Dockerfile:36-41`,
  knip/`validate-commit-msg` dagger entries, dead `.buildkite/scripts/*.sh`.
  `check-dagger-hygiene` → `check-ci-hygiene` (same bans + tmpfs DOCKER_CONFIG carve-out
  - NEW: forbid `buildx create --driver kubernetes` and PVC manifests in the buildkite
    ns). Retire dagger-helper skill; update buildkite-helper/pr-monitor/git-helper skills,
    root CLAUDE.md/AGENTS.md, homelab AGENTS.md, README, greptile config, docs index;
    archive the 3 dagger decision docs + PVC-resize runbook to `archive/dagger-migration/`.
    **Point of no return is deleting the openebs ZFSVolume CR (frees the 2Ti) — do it
    last.** Keep git-mirrors PVC. Buildkite max-in-flight stays 10 until after decommission.

## Top risks

| Risk                                                                        | Sev  | Mitigation                                                                                 |
| --------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| Renovate managers silently stop bumping relocated pins                      | High | Per-PR pin moves + managerFilePatterns in same commit; verify next Renovate run            |
| ~~CI cache fills SeaweedFS → prod sites down~~ (deleted by R2 decision)     | —    | Cache moved to Cloudflare R2 (2026-07-12): failure domain fully separate from prod storage |
| R2 WAN latency erodes cache benefit                                         | Med  | Phase B measures warm-vs-cold delta over WAN; `ignore-error=true` keeps failures soft      |
| LimitRange default OOMKills real-work pods                                  | High | Explicit tiers + ephemeral-storage on every migrated step; default-reliance = bug          |
| node_modules tarball caching serves stale file:-dep copies (canary-blind)   | High | Cache bun's global cache only; real `bun install --frozen-lockfile` every step             |
| Kueue quota (7.5CPU/16Gi) throttles honest-request pods to ~3 jobs          | Med  | Bump quota in C1 with re-tiering; Kueue deleted at C5 after the soak week                  |
| Migration PRs each trigger ~155-step full builds (`.dagger/` in INFRA_DIRS) | Med  | Few big category PRs; Phase A auto-cancel verified first                                   |
| Main-merge wall time grows (no cross-build memoization)                     | Med  | Accept; auto-cancel + (later) merge batching                                               |
| Silent-stale S3 cache keys                                                  | Med  | Nightly no-cache canary from C2a; weekly double-build hit-rate assertion                   |
| nvme1 ephemeral write pressure on 24-image merge builds                     | Med  | Image concurrency_group 2-3; ephemeral-storage limits; keep nvme dashboards                |
| Loss of Dagger OTel spans (Tempo/Loki per-exec)                             | Low  | Accept; BK job timing remains; todo if missed                                              |

## What's accepted as lost

Cross-build/function memoization (7-day content-addressed cache) — main re-runs what PR
CI ran; one transparent CAS becomes 3-4 narrower caches; arbitrary non-compile steps lose
caching unless hand-keyed (don't hand-key; let them run); hermeticity becomes convention
(digest-pinned images + lockfiles) rather than enforcement.

## Local dev after

Checks: `cd packages/<pkg> && bun run lint|typecheck|test` — CI runs literally the same
commands (parity improves; `dagger call` reproduction disappears as a concept). Images:
`docker buildx bake <target>` with the same bake file; smokes via
`bun scripts/ci-steps/smoke/<img>.ts --local`.

## Verification

- Phase B produces go/no-go numbers (bytes written, wall-clock, cache behavior) before
  any bulk migration.
- Nightly no-cache canary (scheduled build, `FULL_BUILD=true NO_CACHE=1`) from C2a.
- Generator determinism test (build pipeline twice → deep-equal), catalog↔bake
  consistency test, existing codegen fail-if-stale gates carry over.
- Per-PR: the migrated checks themselves + smoke tests + dryrun parity are the oracle;
  rendered-pipeline grep gates decommission.

## Appendix — full cleanup inventory (execute at C5; verified against the live tree 2026-07-11)

**Load-bearing code/config:** `scripts/ci/src/steps/{per-package,images,sites,helm}.ts`
(WORKSPACE_DEPS imports — C0); `scripts/ci/src/lib/validate-catalog.ts:164` (constants.ts
read); `scripts/ci/src/lib/buildkite.ts` (DAGGER_MOD_REF/DAGGER_CALL/DAGGER_ENV/daggerStep);
`scripts/ci/src/lib/k8s-plugin.ts:134-135` (`_EXPERIMENTAL_DAGGER_RUNNER_HOST`) + its test;
`renovate.json` (4 custom managers on `.dagger/src/constants.ts` + dagger-helm packageRule);
`lefthook.yml` (dagger-hygiene job, eslint-dagger job, `**/.dagger/**` glob);
`scripts/check-dagger-hygiene.{sh,ts}` (→ check-ci-hygiene); `scripts/generate-deps.ts`;
`scripts/setup.ts` (.dagger install phase); `scripts/quality-ratchet.ts` +
`scripts/check-suppressions.ts` (path lists); `scripts/validate-commit-msg.ts` ("dagger"
scope); `knip.json` (.dagger workspace + @dagger.io dep); `dagger.json`;
`.dagger/prompts/refine-release-please.md` (relocates with the release PR, C4);
`.buildkite/ci-image/Dockerfile:36-41` (dagger CLI + DAGGER_VERSION Renovate ARG);
`scripts/pyright-check.sh` version-sync comment.

**Homelab infra:** `argo-applications/dagger.ts` (STS, 2Ti VCT, engine.json GC config,
docker-config-builder Job, ZFS tuning Job, Service); `monitoring/rules/dagger.ts` (3
alerts) + import in `monitoring/prometheus.ts`; `versions.ts` dagger-helm pin;
`generated/helm/dagger-helm.types.ts` (auto-regens away); kueue.ts + kueue-config.ts (+
quota==max-in-flight test); buildkite.ts comments referencing the dagger flow. Same-PR
replacements: SeaweedFS cache-fill alert, nvme1 ephemeral-pressure alert.

**Skills/dotfiles:** `packages/dotfiles/dot_agents/skills/dagger-helper/` (archive);
`buildkite-helper/SKILL.md` (engine address, "all CI via dagger call", log-signature
table); `pr-monitor/SKILL.md`; `pr-workflow-automation/SKILL.md`; `git-helper/SKILL.md`;
dotfiles AGENTS.md/\_summary.md mentions.

**Docs/agents guidance:** root `CLAUDE.md`/`AGENTS.md` ("Dagger & CI Code — Banned
Patterns" section survives as the check-ci-hygiene contract, reworded; "Don't blame the
cache" reference); `packages/homelab/AGENTS.md`; `README.md`; `.greptile/config.json`;
`packages/docs/index.md`; archive `guides/2026-06-07_dagger-engine-pvc-resize.md` + the 3
dagger decision docs to `archive/dagger-migration/`; `.buildkite/pipeline.yml` comment;
`packages/temporal` comments + `symbol-index.ts` ".dagger" entry.

**Likely-dead already (audit with rendered-pipeline grep):**
`.buildkite/scripts/{cooklang-create-release,cooklang-push,homelab-argocd-health,homelab-helm-push,homelab-tofu-stack,publish-npm-package,update-versions}.sh`.

**User-level (outside repo, flag to owner):** `~/.claude/skills/dagger-helper`; global
`~/.claude/CLAUDE.md` mentions Dagger in skill-loading examples.

## Addendum — GitHub-Actions-hosted alternative (recorded, not chosen)

The owner chose **Buildkite stays** this session; this records the adversarial analysis of
the GHA-hosted alternative so the comparison isn't lost, with claims verified.

- **History nuance (verified):** there is no GHA→Buildkite decision record. The bad GHA
  experience was **self-hosted ARC runners + monolithic workflows** (pre-monorepo;
  ARC CRD-finalizer breakage in `archive/homelab-audits/2026-03-28_homelab-health-audit.md`
  §11); Buildkite was adopted at consolidation for dynamic pipeline upload
  (`archive/bazel/2026-02-22_buildkite.md`). **Free hosted runners were never tried.**
- What GHA-hosted would eliminate: the SeaweedFS cache shared-fate risk, the entire
  resource-model inversion (tiers/Kueue/LimitRange/buildkitd pod-security), and all
  CI writes/heat on the prod node. Caveat on the write/thermal claim: the oft-cited
  4.2 TB/day Buildkite overlayfs figure predates the 2026-05-31 checkout-skip refactor,
  and TJMax throttling was fixed by the AIO cooler 2026-05-26 (≤91 °C since) — the
  current-state benefit is real but smaller than that figure suggests.
- Notable GHA specifics (verified): npm Trusted Publishing/OIDC works only on
  GHA-class providers (`guides/2026-05-20_npm-granular-token-rotation.md`) and
  `GITHUB_TOKEN` could replace the GHCR PAT; all deploy endpoints except **tofu state
  backends** are already public Cloudflare-tunnel hostnames — all 8
  `src/tofu/*/backend.tf` files point at tailnet-only `seaweedfs-s3.tailnet-1a49.ts.net`,
  so tofu is the one step class structurally needing cluster adjacency (tailscale
  GH action, public S3 hostname, or a small on-cluster runner would solve it).
- New GHA-side risks: no runtime pipeline upload (matrix-generation pattern replaces it;
  most of `scripts/ci` would survive, only the emission layer changes), public-repo
  secrets hygiene, 10 GB actions/cache quota, 4-vCPU runner ceiling (dpp/temporal-worker
  are the stress cases), GitHub as a single point of failure, Buildkite-shaped tooling
  sweep (toolkit bk/pr, pr-monitor skill, commit-status contexts).
- **No-regret moves shared by both candidates:** Phase A (work reduction, auto-cancel
  verification) and the C0 deps.ts relocation don't depend on the provider choice.
- If this decision is ever revisited, the cheap test is a one-day spike: build
  discord-plays-pokemon + temporal-worker on a hosted runner and check wall-clock/disk.

## Session Log — 2026-07-11 (v2 rewrite session)

### Done

- Corrected v1's false "approved by owner" Status line the moment it was flagged.
- Full exploration: `.dagger/src` inventory (~8.7k lines, 87-119 fns), `scripts/ci`
  coupling (>95% of steps are `dagger call`), infra + 8-month outage history, PR #1408
  interaction, Renovate/generator coupling into `.dagger/` (verified against live tree).
- Owner decisions captured: Buildkite stays; affected-only builds stay; compute =
  recommend (→ homelab with exit triggers); Bun layout = "not sure" (→ decoupled, #1408
  its own track with the change-detection prerequisite).
- Two design agents (migration architect + adversarial risk analyst) produced the step
  anatomy, buildx/dind pattern, sequencing, risk register, and cleanup inventory;
  disagreements adjudicated (bun global cache over tarballs; per-PR constants moves over
  bulk relocation; no shadow-running — Phase B validates instead).
- This v2 plan written.

### Remaining

- Owner review/approval of this v2 plan.
- Phase A pre-work, then Phase B measurement session (hard gate), then C0-C5.
- Decide #1408 sequencing explicitly (recommended: #1408 first + lockfile-aware change
  detection as its prerequisite).

### Caveats

- v1 of this doc claimed owner approval it did not have; trust nothing here as "decided"
  beyond the four owner answers listed in Status.
- Phase B is a hard gate — the SeaweedFS shared-fate risk (prod sites live there) must
  produce an isolation design, not just timing numbers.
- Effort estimates (~9-12 sessions) are the architect agent's; treat as rough.
