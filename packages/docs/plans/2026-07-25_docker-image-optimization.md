---
id: plan-2026-07-25-docker-image-optimization
type: plan
status: in-progress
board: false
---

# Docker Image Optimization — Slim Images + Precise Rebuild Scoping

Mirror of the approved harness plan (`~/.claude/plans/yeah-i-think-we-lively-parasol.md`), 2026-07-25.

## Context

Measured via crane (compressed, linux/amd64): the 9 Bun app images total ~6.8 GiB. Every one carries a ~200 MiB `COPY . .` whole-monorepo layer that invalidates on EVERY commit (re-pushed/re-pulled ×9 per merge), a ~345–397 MiB install layer including devDependencies, and single-stage builds that keep compilers in runtime (streambot: build-essential/cmake). ci-base is 2282 MiB (988 MiB baked bun cache + 828 MiB mise toolchain). Separately, `select-image-targets.ts` whole-fleet triggers (`GLOBAL_IMAGE_INPUTS`) rebuild+redeploy everything on root tooling bumps, patch edits, and any `.buildkite/` change.

**Decisions (user):** ONE big PR; uniform run-from-source pattern (no `bun build --compile`); ci-base included; bun cache moves from ci-base to a node-local volume (homelab change), with a concurrency spike.

## Target sizes

| Image               | Now (MiB) | Target | Image           | Now  | Target |
| ------------------- | --------- | ------ | --------------- | ---- | ------ |
| tasknotes-server    | 331       | ~110   | birmel          | 951  | ~650   |
| trmnl-dashboard     | 329       | ~110   | mario-kart      | 894  | ~600   |
| starlight-karma-bot | 342       | ~120   | pokemon         | 1037 | ~750   |
| scout-for-lol       | 693       | ~375   | temporal-worker | 1368 | ~1050  |
| streambot           | 880       | ~500   | ci-base         | 2282 | ~1300  |

Plus: source-layer invalidation becomes closure-scoped; root tooling bumps / patch edits stop redeploying the fleet.

## The Dockerfile pattern (all 9 app images)

Four stages; **runtime never runs `bun install`** — only COPYs:

```dockerfile
FROM oven/bun:1.3.14@sha256:… AS base           # WORKDIR /app
# [streambot only] base-build = base + build-essential cmake pkg-config

FROM base AS deps            # full install (dev deps) — feeds artifact builds
COPY --parents <existing manifest glob> ./
RUN bun install --frozen-lockfile --filter '<owner>' [--filter '<extra>']

FROM deps AS build           # scoped source + gitignored-artifact builds
COPY --parents tsconfig.base.json <closure + build-only dirs> ./
RUN …            # llm-models/dist builds, prisma generate, vite builds, toolkit compile

FROM base AS prod-deps       # production-only node_modules; caches on manifests
COPY --parents <same manifest glob> ./
RUN bun install --frozen-lockfile --production --filter '<owner>'

FROM base AS runtime
# apt/CLI layers unchanged (gh/claude/kubectl/ffmpeg/yt-dlp…), kept above app layers
COPY --from=prod-deps /app/ /app/
COPY --parents tsconfig.base.json <runtime closure dirs> ./
COPY --from=build <each built artifact> <same path>
ENV NODE_ENV=production … ARG VERSION/GIT_SHA … WORKDIR /app/packages/<pkg>
CMD ["bun", "src/index.ts"]
```

Key verified facts: isolated-linker node_modules uses RELATIVE symlinks → `COPY --from` between same-rooted stages is safe. Prisma clients generate into in-package source dirs → COPY-able from build. `--frozen-lockfile` still needs every workspace manifest (glob stays). Try `RUN --mount=type=cache,target=/root/.bun/install/cache` on install RUNs in the spike; drop if problematic.

**Fallback ladder if `--production --filter` misbehaves on bun 1.3.14 (Phase 0 spike):** F1 `--production` unfiltered; F2 filtered without `--production` (keeps scoped-COPY architecture + no-churn win regardless). Stage topology identical under all three.

## Phases (commits within the single PR)

### Phase 0 — Spike (tasknotes-server, in worktree, local only)

Convert `packages/tasknotes-server/Dockerfile`; `docker buildx bake tasknotes-server` (go/no-go on `--production --filter`); assert no `node_modules/.bun/typescript*`; run smoke (`bun --no-install --cwd packages/tasknotes-server scripts/smoke.ts`); size via `docker save | gzip | wc -c`; churn check (unrelated-package commit → 100% CACHED re-bake; in-closure commit → install layers cached).

### Phase 1 — Selector precision (`.buildkite/scripts/select-image-targets.ts` + test)

- Split `GLOBAL_IMAGE_INPUTS` into hard globals vs attributable. Hard list drops `package.json`, `scripts/package.json`, `patches/`; replaces `.buildkite/` with image-shaping files only (`bake-images.sh`, `bake-retry.sh`, `select-image-targets.ts`; verify pipeline.yml for others the images step sources).
- New exports: `manifestChangeIsGlobal(pair)` (allowlist: only `devDependencies`/`scripts` keys may differ; anything else/parse-fail/base-null → true → ALL); `patchFileDepName(path)` (`patches/<dep>@<ver>.patch` → dep, else null → ALL); `closurePackageNames(closureDirs, lock)` (extract shared walk from `closureFingerprint`).
- `patches/` changes attribute per-dep via HEAD lockfile closure names (patch-content edits don't touch bun.lock — needs `headLockfile` input even without a lock diff). Fail-open try/catch → ALL, mirroring the lockfile branch.
- Extend optional param to `inputs?: { lockfiles?, rootPackageJson?, scriptsPackageJson?, headLockfile? }`; generalize `baseLockfile` → `baseFile(base, path)`. `bake-images.sh` contract unchanged.
- Tests follow existing patterns (synthetic units + real-repo integration + fail-open): devDeps-only root diff → []; patches/twisted → ["scout-for-lol"]; discord-player-youtubei → ["birmel"]; `.buildkite/scripts/upload-pipeline.sh` → []; `bake-images.sh` → ALL; malformed anything → ALL.

### Phase 2 — Simple images: tasknotes-server (from spike), trmnl-dashboard, starlight-karma-bot

Closures: tasknotes {tasknotes-server, tasknotes-types}; trmnl {trmnl-dashboard, home-assistant}; starlight {starlight-karma-bot}. No artifact builds. `USER bun` over root-owned node_modules is fine (read-only; no chown). Preserve starlight HEALTHCHECK path. Add `.dockerignore`: `**/__snapshots__/`, `packages/sjer.red/src/content/`. Fix stale `packages/tasknotes-server/CLAUDE.md` "NOT a workspace member" line.

### Phase 3 — Medium: birmel, scout-for-lol

- birmel: closure {birmel, llm-observability}; CLI layers unchanged; yt-dlp RUN moves to runtime AFTER prod-deps COPY (writes into `packages/birmel/node_modules/youtube-dl-exec/bin/`); prisma generate in build → COPY `packages/birmel/generated/`; verify no prisma at boot.
- scout: closure {backend, data, report, llm-models, llm-observability} + BOTH tsconfig.base.json files; llm-models dist + prisma generate in build; **promote `prisma` devDep → dependency** (CMD runs `bunx prisma migrate deploy`; under --production bunx would network-install at boot); CONTRACT_HASH stays in runtime.

### Phase 4 — Complex: temporal-worker, streambot

- temporal: ~12 CLI layers verbatim in runtime; deps installs temporal+toolkit, prod-deps temporal only; toolkit compiled in build → COPY `/usr/local/bin/toolkit`; `ensure-ha-schema.ts` runs in RUNTIME (writes gitignored file into source tree); closure {temporal, home-assistant, llm-models, llm-observability}; keep `BUN_INSTALL_CACHE_DIR=/tmp/bun-install-cache`.
- streambot: `base-build` carries compilers; deps AND prod-deps inherit it (native postinstalls run in both); **runtime drops build-essential/cmake/pkg-config** (keep ffmpeg/libva/vainfo/iHD/curl/ca-certs/python3); closure {streambot, discord-stream-lifecycle, discord-video-stream}; both dist builds → COPY.

### Phase 5 — Complex+wasm: discord-plays-pokemon, discord-plays-mario-kart

wasm-builder stages byte-unchanged; `COPY --from=wasm-builder` moves to runtime. Frontend vite builds in build stage (`VITE_SENTRY_RELEASE=dev` before them) → COPY `packages/frontend/dist`. Runtime source COPY enumerates subpaths (backend, common, package-root config files) — EXCLUDE `wasm-src/` + frontend source. pokemon: codex install stays in runtime; `pokemonctl` install after node_modules+source COPY. mario: prisma generate in build → COPY generated/; **promote `prisma` → dependencies** (CMD runs `bunx prisma db push`). prod-deps filters narrow to `@…/backend`.

### Phase 6 — ci-base (`.buildkite/ci-image/Dockerfile` + homelab)

- **Bun cache → node-local volume**: drop the `bun-cache-warm` stage (−988 MiB); mount a node-local cache path into Buildkite agent pods (homelab: agent podSpec in cdk8s) and set `BUN_INSTALL_CACHE_DIR` to it. SPIKE FIRST: concurrent `bun install` sharing a download cache. Fallback: keep the baked cache; still do the mise split.
- **mise layer split**: separate `mise install rust` / `java` / `go` RUNs before the catch-all `mise install`, so a small tool bump stops re-pushing 828 MiB.
- Keep: rust/java/go (verify needs them), claude CLI (release step), apt build-essential (native postinstalls during CI installs).

### Phase 7 — Verify + PR

Per image: bake with dev defaults + smoke script + size table (before via crane on :latest, after via `docker save | gzip | wc -c`) + churn assertions. Selector: `bun test .buildkite/scripts/select-image-targets.test.ts`. Repo: `bun run verify -- --affected`.

## Post-merge watch (first main build)

- All images rebuild (Dockerfile + `.dockerignore` are global — one-time); content gate logs `content CHANGED … will bump` per image → version commit-back → single fleet redeploy event. Watch Argo health per service.
- **Critical second signal**: the NEXT unrelated main build must log `content unchanged … no version bump` for every converted image (proves cache-stable layout). Known caveat (pre-existing): cache-cold rebuild after buildkitd GC can produce one spurious bump.

## Implementation amendments (2026-07-25, same session)

- **Patch attribution is version-exact.** `patchedDependencyKey` resolves the
  changed patch file to its `dep@version` key via the manifest's
  patchedDependencies, and `closurePackageIds` matches it against resolved
  lockfile ids — an image resolving a DIFFERENT version of the same dep is
  correctly unaffected.
- **Finding — two stale patches:** `patches/twisted@1.73.0.patch` and
  `patches/satori@0.18.3.patch` pin versions nothing in bun.lock resolves
  anymore (twisted@1.81.0, satori@0.26.0 are the live resolutions), so bun is
  NOT applying those patches anywhere today. Pre-existing; not fixed in this
  PR — decide whether to re-pin the patches or delete them.
- **mise layer split dropped:** Docker layer cache keys are chain-based (every
  RUN after `COPY .mise.toml` invalidates on any .mise.toml edit), so
  splitting `mise install` into per-tool RUNs cannot save any re-push. ci-base
  work is solely the baked-bun-cache removal.
- **Scout needed no prisma promotion** (already a runtime dependency); mario
  did (moved `prisma` devDep → dependency, bun.lock regenerated).
- **Bun-cache volume wired via the agent-stack controller pod-spec-patch**
  (`buildkite.ts`), not per-anchor pipeline.yml edits: pod-level
  `buildkite-bun-cache` PVC volume + `container-0` mount +
  `BUN_INSTALL_CACHE_DIR=/buildkite/bun-cache` env, merged into every step pod
  by name. Concurrency spike passed (two concurrent cold-cache installs
  sharing one BUN_INSTALL_CACHE_DIR).
- `.buildkite/scripts/docker-env.sh` added to the hard-global list (the image
  steps source it).

## Rebase reconciliation with the no-dind cache cutover (PR #1663)

While this work was in flight, `ed13d1bb7` (no-dind cutover, plan
`2026-07-25_ci-no-dind-cache-cutover.md`) landed on main and rewrote the same
surface: every app Dockerfile gained trailing `smoke` (runs
`.buildkite/scripts/smoke-app-in-image.ts` inside the BuildKit solve) and
`image` (the stage bake tags/pushes, `target = "image"`) stages, bake-images.sh
now solves `--set <t>.target=smoke` then pushes via bake directly, and
buildkite.ts gained a tofu-plugin-cache PVC. Reconciliation on rebase:

- The upstream tail stages were `FROM base AS smoke|image` — correct in
  upstream's single-stage files where `base` WAS the app, but a silent
  empty-image hazard in this PR's multi-stage files where `base` is bare bun.
  Retargeted both stages to `FROM runtime` in all 9 Dockerfiles.
- The smoke stage now COPYs `smoke-app-in-image.ts` from context (upstream
  relied on `COPY . .` shipping `.buildkite/` inside the image; the scoped
  source COPY correctly excludes it — including from the pushed image stage).
- buildkite.ts conflict: kept BOTH PVCs (upstream tofu-plugin-cache + this
  PR's bun-cache); bun-cache PVC adopted upstream's cache conventions
  (NVME_STORAGE_CLASS_LZ4 + velero exclude labels).
- Added `.buildkite/scripts/buildkit-env.sh` (sourced by the new image steps)
  and `smoke-app-in-image.ts` (a harness change must re-smoke every image) to
  the selector's hard globals.
- Merged bun.lock validated with `bun install --frozen-lockfile --dry-run`.
- The earlier LOCAL smoke numbers/validation used the pre-cutover
  `scripts/smoke.ts` docker-run path; post-rebase validation re-ran all nine
  as in-image smoke solves (the exact CI path).

## Measured results (local arm64 `docker save | gzip`; before = crane amd64)

| Image                    | Before   | After    | Cut     |
| ------------------------ | -------- | -------- | ------- |
| tasknotes-server         | 331      | 94       | 72%     |
| trmnl-dashboard          | 329      | 91       | 72%     |
| starlight-karma-bot      | 342      | 103      | 70%     |
| scout-for-lol            | 693      | 465      | 33%     |
| streambot                | 880      | 477      | 46%     |
| birmel                   | 951      | 698      | 27%     |
| discord-plays-mario-kart | 894      | 549      | 39%     |
| discord-plays-pokemon    | 1037     | 693      | 33%     |
| temporal-worker          | 1368     | 1089     | 20%     |
| **Total**                | **6825** | **4259** | **38%** |

Plus ci-base −988 MiB (baked cache removed). All 9 smoke tests pass; churn
checks verified on tasknotes-server (unrelated-package commit → 100% cached;
in-closure commit → only the ~0.4 MB source layer rebuilds). Selector: 34
tests pass.

**Same-architecture validation** (Codex review asked whether the cross-arch
comparison confounds the result): old Dockerfiles from `origin/main` rebuilt
locally on arm64 for three representative images and measured with the same
`docker save | gzip` method as the "after" column —

| Image            | Old (arm64) | New (arm64) | Cut | Cross-arch estimate |
| ---------------- | ----------- | ----------- | --- | ------------------- |
| tasknotes-server | 350         | 94          | 73% | 72%                 |
| scout-for-lol    | 706         | 465         | 34% | 33%                 |
| streambot        | 808         | 477         | 41% | 46%                 |

The per-arch native payloads (Prisma engines, sharp/libvips, ffmpeg, CLIs)
shift absolute numbers a few percent but not the shape of the result; the
authoritative amd64 after-sizes will be readable via crane off the first main
build's pushed images.

## Review-cycle additions (2026-07-26)

- **Embedded-artifact closure attribution** (Codex catch): `TARGET_EXTRA_OWNERS`
  joins toolkit's closure to temporal-worker and the game frontends' closures
  to pokemon/mario in both lockfile-fingerprint and patches attribution — a
  toolkit-only or frontend-only dep bump now rebuilds the image whose baked
  artifact it changes. Regression test via the toolkit-only `asciinema-player`
  lock entry.
- **buildkitd hardening** after PR build 6303 OOMKilled it into a crash loop
  (full-fleet cold bake, all ~15 targets in parallel, 12Gi limit): memory
  limit 12→32Gi and `[worker.oci] max-parallelism = 8` in
  `packages/homelab/src/cdk8s/src/resources/buildkitd.ts`. Unblocked the PR
  build pre-merge by warming the daemon's cache target-by-target (sequential
  `--set <t>.target=smoke` bakes through a port-forward) — which also served
  as full amd64 validation of every slim image.
- Filed `packages/docs/todos/homelab-audit-preflight-tofu-path.md`: the audit
  preflight's CWD-relative tofu path never resolved in-image (pre-existing;
  surfaced by a review comment that read it as a slim-image regression).

## Files touched

`packages/{birmel,streambot,temporal,tasknotes-server,starlight-karma-bot,trmnl-dashboard}/Dockerfile`, `packages/scout-for-lol/packages/backend/Dockerfile`, `packages/discord-plays-{pokemon,mario-kart}/Dockerfile`, `.buildkite/scripts/select-image-targets.{ts,test.ts}`, `.buildkite/ci-image/Dockerfile`, `.dockerignore`, mario backend `package.json` (prisma promotion → bun.lock; scout already had it), homelab cdk8s Buildkite agent podSpec + `buildkitd.ts`, `packages/tasknotes-server/AGENTS.md`, `packages/docs/todos/homelab-audit-preflight-tofu-path.md`.
