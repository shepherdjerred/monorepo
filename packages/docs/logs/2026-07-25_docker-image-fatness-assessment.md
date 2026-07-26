---
id: log-2026-07-25-docker-image-fatness-assessment
type: log
status: complete
board: false
---

# Docker image fatness assessment — are the images part of the pain?

## Question

User: "the docker images are a significant source of pain right now. is part of
that they are just way too fat and unoptimized?"

## Method

- Enumerated all Dockerfiles (15 active: 4 Bun app images, homelab infra
  images, ci-base).
- Pulled compressed manifest sizes for every `ghcr.io/shepherdjerred/*:latest`
  via `crane manifest --platform linux/amd64` (no image pulls).
- Broke down per-layer sizes for temporal-worker, birmel, scout-for-lol,
  streambot, tasknotes-server.
- Sized the build context contributors via `git ls-files | du`.

## Findings — compressed sizes (linux/amd64, :latest)

| Image                                | Compressed         |
| ------------------------------------ | ------------------ |
| ci-base                              | 2282 MiB           |
| temporal-worker                      | 1368 MiB           |
| discord-plays-pokemon                | 1037 MiB           |
| birmel                               | 951 MiB            |
| discord-plays-mario-kart             | 894 MiB            |
| streambot                            | 880 MiB            |
| scout-for-lol                        | 693 MiB            |
| starlight-karma-bot                  | 342 MiB            |
| tasknotes-server                     | 331 MiB            |
| trmnl-dashboard                      | 329 MiB            |
| obsidian-headless                    | 193 MiB            |
| mcp-gateway                          | 146 MiB            |
| redlib / caddy-s3proxy / shelfbridge | 35–40 / 40 / 8 MiB |

Uncompressed on-node is roughly 2.5–3× these numbers.

## Layer anatomy (every Bun app image)

1. **oven/bun Debian base ≈ 83 MiB** — shared, cached, fine.
2. **`bun install` layer ≈ 345–397 MiB compressed** — full workspace closure
   INCLUDING devDependencies (no `--production`); only invalidates on
   manifest/lockfile change (good caching).
3. **`COPY . .` source layer ≈ 199–200 MiB compressed in EVERY image** — the
   entire monorepo source (blog videos in sjer.red, multi-MiB SVG/PNG test
   snapshots, generated cdk8s imports, fonts). Invalidates on EVERY commit to
   anything, so every main build re-pushes and every deploy re-pulls ~200 MiB
   per image even for unrelated changes. temporal-worker + birmel happened to
   share an identical layer digest; scout/streambot/tasknotes each had their
   own.
4. Per-image extras: claude-code global install ≈ 145 MiB, codex ≈ 91 MiB,
   streambot's apt layer (ffmpeg + VAAPI + build-essential + cmake) ≈ 345 MiB —
   build toolchain retained in the runtime image (needed at install time for
   node-datachannel/node-av native builds, but never removed).

## Verdict

Yes — genuinely fat, but the pain profile is specific:

- Layer ORDERING is already good (manifests-first install, source last).
- The recurring cost is the ~200 MiB always-invalidated source layer × N
  images per merge (push in CI, pull on deploy), plus dev deps in the install
  layer (~40–50% of its bulk), plus single-stage builds keeping compilers.
- temporal-worker's CLI zoo (~600 MiB of gh/claude/codex/kubectl/talosctl/
  tofu/argocd/velero/bk/temporal/cog) is intentional runtime surface, not
  waste.

Biggest wins, in order:

1. Scope the source COPY to the filtered package closure instead of `COPY . .`
   (or extend .dockerignore to exclude heavy asset dirs like
   `packages/sjer.red/src/content`, snapshots, showcase PNGs) — cuts ~150+
   MiB/image AND stops repo-wide layer invalidation per commit.
2. Production installs (drop devDependencies) — cuts ~150–200 MiB/image.
3. Multi-stage for streambot (builder with cmake/build-essential, runtime
   without) and for the llm-models/toolkit build steps.

## Follow-up — per-image realistic targets (same session)

User: "it feels like MOST of these can be SIGNIFICANTLY trimmed down." Confirmed
with numbers. The 9 Bun app images total ~6.8 GiB compressed; ~1.8 GiB of that
is 9 copies of the same ~200 MiB whole-monorepo source layer.

Conservative targets (scoped source COPY + production install + multi-stage
where builds happen in-image; no architecture changes):

| Image                    | Now  | Realistic                                                             | Notes                                                      |
| ------------------------ | ---- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| tasknotes-server         | 331  | ~110 (or ~60 via `bun build --compile` — build script already exists) | source layer is 60% of the image                           |
| trmnl-dashboard          | 329  | ~110                                                                  | same shape                                                 |
| starlight-karma-bot      | 342  | ~120                                                                  | same shape                                                 |
| scout-for-lol            | 693  | ~350–400                                                              | prisma stays                                               |
| streambot                | 880  | ~500                                                                  | multi-stage drops build-essential/cmake; ffmpeg+VAAPI stay |
| birmel                   | 951  | ~650                                                                  | claude+gh+node+python are runtime deps, stay               |
| discord-plays-mario-kart | 894  | ~600                                                                  |                                                            |
| discord-plays-pokemon    | 1037 | ~750                                                                  | ffmpeg/libvips/wasm stay                                   |
| temporal-worker          | 1368 | ~1050                                                                 | CLI zoo is deliberate                                      |

Total ~6.8 GiB → ~4.2 GiB; the three simple services shrink 3–5×. Equally
important: scoping the source COPY ends the every-commit invalidation, so a
docs/blog change no longer re-pushes/re-pulls ~200 MiB × 9 images.

Implementation notes for a future session:

- Pattern: builder stage = current full install + dist builds (llm-models,
  discord-stream-lifecycle, frontend); runtime stage = `bun install
--production --filter <app>` + COPY only the app's package-source closure +
  COPY built dists from builder. Verify `--production` + `--filter` behave
  together on bun 1.3 before rollout (historically rough edges).
- turbo prune is banned (corrupts bun.lock — see .dockerignore header), so the
  closure source list is hand-enumerated per Dockerfile, same as the existing
  manifest globs.
- Cheap interim win: extend root .dockerignore to exclude heavy asset dirs
  (packages/sjer.red/src/content, \*\*/**snapshots**, scout showcase PNGs,
  generated cdk8s imports) — one-line-ish change, benefits every image at once.
- Smoke tests already exist per image (`bunx turbo run smoke --filter=<pkg>`),
  so each conversion is verifiable.

## Follow-up 2 — "dep change in X shouldn't rebuild Y/Z"

Read `.buildkite/scripts/bake-images.sh`, `select-image-targets.ts`, and
`docker-bake.hcl`. Finding: **per-image dep attribution already exists** and is
good. `select-image-targets.ts` fingerprints each image's resolved dependency
closure from bun.lock (base vs head) and only selects images whose closure
fingerprint changed; main builds diff against the last green main commit, PRs
against merge-base. A dep bump declared in `packages/X/package.json` already
rebuilds only images whose closure contains X.

The whole-fleet rebuilds come from the blanket `GLOBAL_IMAGE_INPUTS` triggers
(any match → build ALL 14 images):

| Trigger                        | Why it over-selects                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root `package.json`            | its devDeps are repo tooling (turbo, prettier, knip, lefthook, markdownlint, jscpd) that ships in NO image — but any Renovate bump of them rebuilds + **redeploys the fleet** (manifest bytes land in every image via the COPY layers, so the rootfs content-gate sees a real change and bumps every versions.ts pin) |
| `patches/`                     | patch files are per-dep (satori/twisted → scout only, discord-player-youtubei → birmel) but treated as global                                                                                                                                                                                                         |
| root `overrides` change        | flips the lockfile sentinel → every closure fingerprint changes → ALL (right for broad overrides, over-broad for e.g. react-native ones)                                                                                                                                                                              |
| `.buildkite/`                  | ANY CI script change rebuilds all images, though most scripts don't affect image content                                                                                                                                                                                                                              |
| lockfile-attribution fail-open | any bun.lock schema surprise → ALL (correct safety default; frequency unknown)                                                                                                                                                                                                                                        |

Fix directions, ranked by value/effort:

1. **Content-aware root package.json attribution** — parse base vs head; if the
   delta touches only `devDependencies`/`scripts`, skip the global trigger and
   let lockfile fingerprinting decide (root devDeps are in no closure → no
   images selected). Keep `workspaces`/`overrides`/`patchedDependencies`/
   `trustedDependencies` deltas global. Kills the biggest fleet-redeploy
   trigger (repo-tooling Renovate bumps). Same treatment for
   `scripts/package.json`.
2. **Per-dep patches/ attribution** — patch filename encodes the dep; select
   only images whose closure contains it.
3. **Narrow `.buildkite/`** to the files that shape image content/selection
   (bake-images.sh, bake-retry.sh, select-image-targets.ts, pipeline env that
   feeds bake) instead of the whole directory.
4. (Big, optional) **Per-image pruned lockfile** for layer-level decoupling —
   turbo prune is banned (corrupts bun.lock), so this would be a custom
   deterministic pruner reusing the closure walker. Only worth it if 1–3 leave
   measurable pain; the orchestration-level selector already provides most of
   the isolation.

## Session Log — 2026-07-25

### Done

- Measured all 15 published GHCR images (compressed, amd64) via crane.
- Per-layer breakdown of the 5 heaviest app images; identified the shared
  ~200 MiB `COPY . .` layer and ~350–400 MiB dev-dep-inclusive install layer.
- Delivered assessment (analysis only, no changes).

### Remaining

- Nothing committed to act on — optimization work (COPY scoping, --production
  install, multi-stage streambot) awaits user direction.

### Caveats

- Sizes are compressed registry sizes; on-node disk is ~2.5–3×.
- `bun install --filter` + `--production` interaction should be verified
  before relying on it (historically rough edges).
- The user's "pain" wasn't specified (pull latency vs CI time vs GHCR storage
  vs node disk pressure); assessment covers the size dimension only.
