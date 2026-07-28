# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# Headless Discord Plays Pokémon. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in packages/discord-plays-pokemon/packages/backend
# (which passes `-f ../../Dockerfile ../../../..`).
#
# Runs pokeemerald-wasm entirely in Bun, renders frames in software, and streams
# to Discord over the voice UDP path. No X server, no browser, no GPU.
#
# Multi-stage on the Bun side too: deps does a full (dev-inclusive) install to
# feed the dist/frontend builds; prod-deps installs the production-only backend
# closure; runtime COPYs the prod tree, the scoped source closure, the wasm,
# and the built artifacts — it never runs `bun install`. Dev dependencies and
# the rest of the monorepo source never reach the final image, and the source
# layer only invalidates when a closure package changes — not on every repo
# commit.

# ---------------------------------------------------------------------------
# Stage 1 — build pokeemerald.wasm from source.
# ottohg/pokeemerald-wasm at a pinned commit + our checked-in export patch.
# The committed asset is gitignored, so it MUST be produced here (mirrors the
# removed Dagger `buildPokeemeraldWasm` and scripts/build-wasm.ts). The build
# uses clang wasm32-unknown-unknown + wasm-ld (LLVM, NOT emscripten): trixie's
# clang-19 produces a Bun-loadable binary (bookworm's clang-14 does not).
# ---------------------------------------------------------------------------
FROM debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd AS wasm-builder

# Pinned commit of ottohg/pokeemerald-wasm. Kept in sync with the OTTOHG_SHA in
# packages/discord-plays-pokemon/scripts/build-wasm.ts (the single source of
# truth; Renovate's git-refs manager advances both).
ENV OTTOHG_REPO=https://github.com/ottohg/pokeemerald-wasm.git
# renovate: datasource=git-refs depName=pokeemerald-source branch=master
ENV OTTOHG_SHA=c101be5ac2ae53c5d18ee063f16eeeda751639f8

# Toolchain: modern LLVM for wasm32 clang + wasm-ld, build-essential for the
# decomp host tools, libpng/zlib + pkg-config for gbagfx, python3 + uv for the
# sound-data tooling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    clang lld llvm build-essential libpng-dev zlib1g-dev pkg-config \
    git make ca-certificates python3 python3-pip \
  && pip3 install --break-system-packages --no-cache-dir uv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# Clone the pinned fork (shallow fetch of the exact commit).
RUN git clone --no-checkout "$OTTOHG_REPO" . \
  && git fetch --depth=1 origin "$OTTOHG_SHA" \
  && git checkout --detach "$OTTOHG_SHA"

# Apply our export patch (the four extra game-state exports symbols.ts reads).
COPY packages/discord-plays-pokemon/wasm-src/patches /patches
RUN set -e; for p in /patches/*.patch; do \
    echo "applying $p"; patch -p1 --no-backup-if-mismatch < "$p"; \
  done

# The Makefile only builds map headers as a side effect of the GBA `maps.o`
# recipe (which the wasm target never runs), so drive mapjson ourselves —
# mirrors scripts/build-wasm.ts.
RUN make tools \
  && tools/mapjson/mapjson groups emerald data/maps/map_groups.json data/maps include \
  && tools/mapjson/mapjson layouts emerald data/layouts/layouts.json data/layouts include \
  && for d in data/maps/*/; do \
       n=$(basename "$d"); \
       [ "$n" = _unused ] && continue; \
       [ -f "$d/map.json" ] || continue; \
       tools/mapjson/mapjson map emerald "$d/map.json" data/layouts/layouts.json "$d"; \
     done

# Compile the wasm, then fail fast if the artifact is implausibly small
# (the real binary is ~14 MB).
RUN WASM_CC=clang WASM_LD=wasm-ld make wasm \
  && test "$(wc -c < build/wasm/pokeemerald.wasm)" -gt 10000000

# ---------------------------------------------------------------------------
# Bun stages.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# ── deps: full install (dev deps) — feeds the artifact builds below ─────────
# trustedDependencies (node-datachannel, node-av, sharp) run their native
# postinstalls during the frozen install. `--frozen-lockfile` requires every
# workspace member's package.json present, so the globs enumerate every member
# (top-level, nested packages/*/packages/*, homelab/src/*, the desktop
# src-tauri crate, and the `scripts` dir).
FROM base AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@discord-plays-pokemon/*'

# ── build: gitignored artifacts (dists + the web UI) ────────────────────────
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/discord-plays-pokemon/packages/backend \
  packages/discord-plays-pokemon/packages/common \
  packages/discord-plays-pokemon/packages/frontend \
  packages/discord-plays-core \
  packages/discord-stream-lifecycle \
  packages/discord-video-stream \
  packages/llm-models \
  packages/llm-observability \
  ./
# Build the workspace deps whose package `main`/exports resolve to a gitignored
# `dist/` — consumers crash at startup with `Cannot find module` otherwise.
# discord-stream-lifecycle is load-bearing (consumed as compiled JS from the
# nested backend); llm-models' catalog resolves to dist too.
RUN cd packages/discord-stream-lifecycle && bun run build \
  && cd /app/packages/llm-models && bun run build
# Build the web UI served by the backend (web.assets). Expose the release to
# Vite BEFORE the build so the SPA's Sentry.init tags events with `release`.
ENV VITE_SENTRY_RELEASE=dev
RUN cd packages/discord-plays-pokemon/packages/frontend && bun run build

# ── prod-deps: production-only node_modules, cached on manifests ────────────
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@discord-plays-pokemon/backend'

# ── runtime: system deps + CLIs + COPY-only app layers ──────────────────────
FROM base AS runtime

# System deps:
# - ffmpeg: discord-video-stream (fluent-ffmpeg) encodes the rawvideo frame feed.
# - libvips: native lib for sharp (transitive dep of discord-video-stream).
# - Intel VAAPI stack (libva + iHD driver): h264_vaapi hardware encoding on an
#   Intel iGPU. iHD lives in Debian non-free (enabled below) and is amd64-only;
#   software libx264 is the fallback when the device/driver is absent.
RUN set -e; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then sed -i "s/^Components: main.*/Components: main contrib non-free non-free-firmware/" /etc/apt/sources.list.d/debian.sources; fi; \
  apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libvips42 ca-certificates libva2 libva-drm2 vainfo \
  && if [ "$(dpkg --print-architecture)" = "amd64" ]; then apt-get install -y --no-install-recommends intel-media-va-driver-non-free; fi \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Goal mode shells out to Codex. BUN_INSTALL=/usr/local drops the binary into a
# world-readable bin on PATH. Kept ABOVE the app layers: it needs only bun +
# network, and a source edit must not re-download it.
ENV BUN_INSTALL=/usr/local
RUN bun add -g @openai/codex@0.139.0 && codex --version

# Production node_modules + workspace manifests. The isolated-linker tree uses
# relative symlinks (store at node_modules/.bun), so copying the whole install
# root between same-rooted stages is safe. Kept BEFORE the source COPY so a
# source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/

# Scoped source closure. wasm-src and the frontend source are build inputs
# only — the compiled wasm and the built web UI are COPY'd from their stages
# below.
COPY --parents \
  tsconfig.base.json \
  packages/discord-plays-pokemon/config.example.toml \
  packages/discord-plays-pokemon/packages/backend \
  packages/discord-plays-pokemon/packages/common \
  packages/discord-plays-core \
  packages/discord-stream-lifecycle \
  packages/discord-video-stream \
  packages/llm-models \
  packages/llm-observability \
  ./

# Built artifacts from the build stage.
COPY --from=build /app/packages/discord-stream-lifecycle/dist packages/discord-stream-lifecycle/dist
COPY --from=build /app/packages/llm-models/dist packages/llm-models/dist
COPY --from=build /app/packages/discord-plays-pokemon/packages/frontend/dist packages/discord-plays-pokemon/packages/frontend/dist

# Make the goal-mode control CLI available to operators and spawned Codex loops.
RUN install -D -m 0755 \
    packages/discord-plays-pokemon/packages/backend/src/goal/pokemonctl.ts \
    /usr/local/bin/pokemonctl \
  && pokemonctl --help

# Stage the from-source wasm where the emulator expects it (relative to the
# inner-monorepo root the app runs from).
COPY --from=wasm-builder /src/build/wasm/pokeemerald.wasm \
  /app/packages/discord-plays-pokemon/packages/backend/assets/pokeemerald.wasm

# Version/revision metadata as build args so CI can bake the real build number +
# commit SHA (`--build-arg VERSION=… --build-arg GIT_SHA=…`); the `dev`/`unknown`
# defaults keep a plain `docker run` bootable.
ENV NODE_ENV=production
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}

# Run from the inner-monorepo root so getConfig()/emulator resolve config.toml,
# packages/backend/assets/pokeemerald.wasm, and saves/ relative to CWD.
WORKDIR /app/packages/discord-plays-pokemon
CMD ["bun", "packages/backend/src/index.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=discord-plays-pokemon
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# The smoke harness writes its temporary config at the application's normal
# CWD. Prepare that file while this stage is still root, then let the deploy
# uid replace its contents during the actual smoke.
RUN touch /app/packages/discord-plays-pokemon/config.toml \
  && chown 1000:1000 /app/packages/discord-plays-pokemon/config.toml
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
