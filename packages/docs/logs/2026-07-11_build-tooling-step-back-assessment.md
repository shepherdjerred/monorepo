---
id: log-2026-07-11-build-tooling-step-back-assessment
type: log
status: complete
board: false
---

# Build Tooling Step-Back — Is Dagger (or any build graph) the Right Tool?

## Question

After trying Dagger, Earthly, and Bazel — and with Bun workspaces never quite
fitting — is the build tooling approach itself wrong?

## Assessment

The recurring failure isn't any one tool; it's the **tool class**. Hermetic
build-graph systems (Bazel/Earthly/Dagger) are designed for large teams with
dedicated build-infra capacity and elastic CI fleets. This repo is one person
plus AI agents, ~35 heterogeneous packages, on a single homelab node.

Evidence from this repo's own history:

- **Bazel** (Feb–Mar 2026, `archive/bazel/`): no first-class Bun rules meant
  maintaining a custom `rules_bun` v2 framework; 55-item anti-pattern audit;
  removed ~2026-03-19.
- **Earthly**: company shut down; dead end.
- **Dagger**: two paged outage cycles caused by the _stateful shared engine_
  itself — 2026-02 write amplification (PagerDuty #3042, load 587/32 cores) and
  2026-06/07 EDQUOT disk-full outages (`decisions/2026-06-07_dagger-gc-and-pvc-drift.md`),
  where a Renovate storm wrote ~670 GB in 100 min through a healthy GC.
  Concurrency had to be Kueue-serialized to protect the node, and
  `--source .` targets rarely hit cache (`decisions/2026-04-03_dagger-source-vs-plain-steps.md`) —
  so the parallelism + cache value proposition never pays out here.

## Recommended direction (not yet decided)

Split the three jobs the graph tools conflate:

1. **Orchestration + affected-detection** — already owned: `scripts/ci`
   (TS pipeline generator + change detection → Buildkite). Keep it. (moon is
   the fallback candidate if a task runner is ever wanted.)
2. **Hermeticity** — mise-pinned toolchains + pinned Buildkite agent images +
   pinned scanner versions covers ~90% at ~0% of the cost. The 2026-04-03
   decision doc already classifies most checks as fine outside containers.
3. **Image builds** — the only genuine BuildKit need. Plain `docker buildx`
   with **registry-backed cache** (`--cache-to/--cache-from type=registry`)
   makes the cache stateless: no engine PVC, no GC tuning, no quota deadlocks.

Migration cost: ~20 modules in `.dagger/src/` → Dockerfiles + Bun/shell
scripts; most are thin wrappers over `bun run <script>` already.

## Revision — 30-day commit-pattern analysis (same session)

The user challenged the "wrong tool class" framing with three hypotheses.
Measured against 437 file-changing commits on main over 30 days
(323 human, 67 Renovate, 52 babysitter bot):

1. **"Cache hits should be frequent" — TRUE structurally.** Excluding
   `packages/docs` (logs ride along with most commits): 60% of commits touch
   exactly 1 code package, 8% touch 2, 5% touch 3+, 26% touch none.
   Per-package lockfiles keep dep bumps scoped (root `bun.lock`: 2 commits/30d).
   Caveats: **22% of commits touch a global invalidator** (`.dagger/`,
   `scripts/`, `.buildkite/`, root config) → full fan-out; **homelab is in 44%
   of commits** and drives the `--source .` targets that rarely hit cache.
2. **"Hits cheap enough for one node" — TRUE; hits were never the problem.**
   Both outages were _miss storms_ (concurrent builds writing 10s–100s GB of
   new layers). Dagger misses are uniquely write-heavy (source snapshots +
   node_modules layers on CoW ZFS, per branch variant).
3. **"128 GB / 32c is enough" — TRUE for compute.** CPU/RAM never failed;
   every incident was the stateful cache dataset (quota deadlock, GC
   semantics, PVC drift).

**Revised conclusion:** not "abandon the paradigm" — the requirements
(incremental + cached + one beefy node) match the commit patterns well.
The failures are narrower: (a) Dagger's stateful, write-amplified cache
store, and (b) over-broad invalidation (~1 in 5 commits full-fans-out,
partly from unrelated files landing in Renovate squash-merges, e.g.
`70d13b90d` — a Talos bump that also touched `scripts/ci` test files).
Fix path: another over-building audit like 2026-04-26 (cheap), plus moving
`--source .`/image-build caching to stateless registry-backed buildx.
No fourth build-tool migration warranted.

Analysis script: session scratchpad `commit-analysis.ts` / `refine.ts`
(methodology: `git log --since="30 days ago" --name-only` on main; package =
first dir under `packages/`; global invalidator = root lock/package.json,
`.dagger/`, `scripts/`, `.buildkite/`, tsconfig, mise).

## Correction — source ingestion model (same session)

CI does **not** client-sync source into the engine. Since the 2026-05-31
git-URL refactor (`plans/2026-05-31_bk-dagger-git-url-refactor.md`,
`scripts/ci/src/lib/buildkite.ts` `REPO_GIT_REF`), every step passes
`--source <repo-url>#$BUILDKITE_COMMIT` and the engine fetches server-side,
once per SHA, content-addressed; BK pods skip checkout entirely.

Consequences for the analysis above:

- The July 3 outage's ~670 GB/100 min was **build-output layers** (dep
  installs, node_modules, images) — not source sync. A buildx migration
  would generate similar write volume; it relocates the cache store, it
  doesn't shrink writes.
- "Dagger isn't meant for monorepos" is overstated for this repo: the worst
  monorepo behavior is already engineered away, and `gitDir()` subdir refs
  can cache-hit across SHAs when package content is unchanged.
- The remaining exit rationale is **deleting the stateful-engine failure
  domain** (PVC/GC/quota/Kueue/alert ops surface), not performance.
  Phase 0 (over-invalidation audit) is the highest value-per-effort move.

## Next step (if pursued)

Plan-mode session: inventory every `.dagger/src` function, classify each as
plain-step / docker-buildx / delete, design the registry cache layout, and
produce a phased migration plan.

## Deep research (same session)

A 10-agent deep-research pass (~170 sources, adversarial review with source
verification) produced the full landscape report:
`~/.claude-extra/research/monorepo-build-system-landscape.{md,typ,pdf}`
(indexed in recall). Headline conclusions:

- **Architecture shape settled:** native toolchains + generated drift-checked
  orchestration + affected-detection + stateless external caches — what every
  surveyed peer runs (Bun's repo = near-exact blueprint: JS pipeline generator
  on self-hosted Buildkite). Nobody at this profile runs a cross-language
  build graph or a stateful build engine.
- **Near-unconditional:** (1) batching merge queue (Mergify/Trunk) + Renovate
  grouping — the actual fix for the July-3 storm class; (2) exit stateful
  build-cache datasets as a class (Dagger engine, buildkitd-with-PVC, Nix
  store, baur/PostgreSQL all share the GC-babysitting failure mode).
- **Stateless-cache design** (buildx `type=s3`→SeaweedFS, per-job rootless
  buildkitd never-a-PVC, Zot registry, sccache/GOCACHEPROG/keyed tarballs):
  right in principle, unvalidated — needs Phase-0 measurement + no-cache
  canary build.
- **Open trade:** keep the bespoke scripts/ci generator vs adopt moon —
  default keep, re-evaluation triggers documented in the report §10.
- **Nix:** dev-shells at most (store = stateful dataset again; Swift/Tauri
  uncovered; garn dead). **CAS newcomers** (Tangram/Brioche/zb/NativeLink):
  all bus-factor-1 pre-1.0 — watch-list only.
- **Codegen seams:** guard with fail-if-stale drift-check jobs (PostHog
  pattern) + drift-check the generated pipeline itself (Zed pattern).

## Session Log — 2026-07-11

### Done

- Reviewed build-tooling history across `decisions/` and `archive/bazel/`
  and delivered a step-back assessment (this doc). No code changes.
- 30-day commit-pattern analysis validating the user's cache hypotheses.
- Corrected the source-ingestion model (git-URL refs since 2026-05-31).
- Full deep-research landscape report (see above) delivered as md/typ/pdf.

### Remaining

- Decision not yet made. Natural next steps, in order of leverage:
  (1) batching merge queue + Renovate grouping (independent of build tooling);
  (2) Phase-0 stateless-cache measurement on the node (buildx type=s3 →
  SeaweedFS, bytes-written + hit-rate, cache-plugin concurrency);
  (3) plan-mode Dagger-exit inventory of `.dagger/src/` if Phase-0 validates.

### Caveats

- One of two `toolkit recall search` queries returned empty output (exit 0,
  no results, no error) — possibly flaky; the second query worked fine.
- Corroborating sources found via recall: `archive/dagger-migration/2026-03-19_dagger-migration.md`
  (Bazel dropped for OOMs, slow startup, Astro/Vite pain) and
  `~/.claude/research/bazel-vs-brazil-vs-make.md` (Bazel pays off only at
  team scale).
