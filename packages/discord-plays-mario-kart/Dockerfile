# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# Headless Discord Plays Mario Kart. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in packages/discord-plays-mario-kart/packages/backend
# (which passes `-f ../../Dockerfile ../../../..`).
#
# Runs the N64Wasm core (parallel-n64 + angrylion software RDP) entirely in Bun,
# renders frames in software, and streams to Discord over the voice UDP path.
# No X server, no browser, no GPU.
#
# Multi-stage on the Bun side too: deps does a full (dev-inclusive) install to
# feed the dist/Prisma/frontend builds; prod-deps installs the production-only
# backend closure; runtime COPYs the prod tree, the scoped source closure, the
# compiled core, and the built artifacts — it never runs `bun install`. Dev
# dependencies and the rest of the monorepo source never reach the final
# image, and the source layer only invalidates when a closure package changes —
# not on every repo commit.

# ---------------------------------------------------------------------------
# Stage 1 — compile the N64Wasm core from the vendored source.
# The committed `wasm-src/code` tree is BYTE-PRISTINE upstream; our changes
# (neilSetRom, neilGetVideoBuffer/Height, the per-player input export, the
# Makefile exports) live in `wasm-src/patches/` and are applied here at build
# time. No binaries are committed — the build is reproducible from source.
# Pinned Emscripten 6 toolchain for the legacy SDL2/GLES2 core.
# ---------------------------------------------------------------------------
FROM emscripten/emsdk:6.0.5@sha256:76a44fff907397784decc435115d07fcb9587a4f1504977f39f3745e538e3a1e AS wasm-builder

WORKDIR /src
# Copy only the vendored wasm source tree (patches + the pristine `code/` tree).
COPY packages/discord-plays-mario-kart/wasm-src /src

# Apply our patch series (patch(1) ships in the emscripten image; /src is not a
# git work tree, so use patch, not git apply).
RUN set -e; for p in patches/*.patch; do \
    echo "applying $p"; patch -p1 --no-backup-if-mismatch < "$p"; \
  done

# `make clean` drops any object files so the patched sources are rebuilt from
# scratch; `make` emits n64wasm.js + n64wasm.wasm in this dir.
WORKDIR /src/code
RUN make clean && make

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
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@discord-plays-mario-kart/*'

# ── build: gitignored artifacts (dist + Prisma client + the web UI) ─────────
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/discord-plays-mario-kart/packages/backend \
  packages/discord-plays-mario-kart/packages/common \
  packages/discord-plays-mario-kart/packages/frontend \
  packages/discord-plays-core \
  packages/discord-stream-lifecycle \
  packages/discord-video-stream \
  ./
# discord-stream-lifecycle's package resolves to a gitignored `dist/`; consumed
# as compiled JS from the nested backend, it must be built or the app crashes at
# startup with `Cannot find module '@shepherdjerred/discord-stream-lifecycle'`.
RUN cd packages/discord-stream-lifecycle && bun run build
# Generate the Prisma client for the leaderboard DB (output is gitignored).
RUN cd packages/discord-plays-mario-kart/packages/backend && bunx --trust prisma generate
# Build the web UI served by the backend (web.assets). Expose the release to
# Vite BEFORE the build so the SPA's Sentry.init tags events with `release`.
ENV VITE_SENTRY_RELEASE=dev
RUN cd packages/discord-plays-mario-kart/packages/frontend && bun run build

# ── prod-deps: production-only node_modules, cached on manifests ────────────
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@discord-plays-mario-kart/backend'

# ── runtime: system deps + COPY-only app layers ─────────────────────────────
FROM base AS runtime

# System deps:
# - ffmpeg: discord-video-stream (fluent-ffmpeg) encodes the rawvideo frame feed.
# - libvips: native lib for sharp.
# - fontconfig: sharp/libvips text rendering (the leaderboard name overlay).
# - Intel VAAPI stack (libva + iHD driver): h264_vaapi hardware encoding on an
#   Intel iGPU. iHD lives in Debian non-free (enabled below) and is amd64-only;
#   software libx264 is the fallback when the device/driver is absent.
RUN set -e; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then sed -i "s/^Components: main.*/Components: main contrib non-free non-free-firmware/" /etc/apt/sources.list.d/debian.sources; fi; \
  apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libvips42 fontconfig ca-certificates libva2 libva-drm2 vainfo \
  && if [ "$(dpkg --print-architecture)" = "amd64" ]; then apt-get install -y --no-install-recommends intel-media-va-driver-non-free; fi \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production node_modules + workspace manifests. The isolated-linker tree uses
# relative symlinks (store at node_modules/.bun), so copying the whole install
# root between same-rooted stages is safe. Kept BEFORE the source COPY so a
# source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/

# Scoped source closure. wasm-src and the frontend source are build inputs
# only — the compiled core and the built web UI are COPY'd from their stages
# below.
COPY --parents \
  tsconfig.base.json \
  packages/discord-plays-mario-kart/config.example.toml \
  packages/discord-plays-mario-kart/packages/backend \
  packages/discord-plays-mario-kart/packages/common \
  packages/discord-plays-core \
  packages/discord-stream-lifecycle \
  packages/discord-video-stream \
  ./

# Bake the Prisma engines into the production tree. prod-deps installs
# without lifecycle scripts, so @prisma/engines ships empty and the CLI
# downloads engines on FIRST USE — but the pod runs as uid 1000 over this
# root-owned node_modules, so the startup `prisma db push` died with
# "Can't write to …@prisma+engines…" (image 2.0.0-6322 crash-loop).
# Running generate here (as root, schema present from the source COPY above)
# fetches them at build time; verified in-container: after this, db push as
# uid 1000 proceeds straight to the database step.
RUN cd packages/discord-plays-mario-kart/packages/backend && bunx --trust prisma generate

# Built artifacts from the build stage.
COPY --from=build /app/packages/discord-stream-lifecycle/dist packages/discord-stream-lifecycle/dist
COPY --from=build /app/packages/discord-plays-mario-kart/packages/backend/generated packages/discord-plays-mario-kart/packages/backend/generated
COPY --from=build /app/packages/discord-plays-mario-kart/packages/frontend/dist packages/discord-plays-mario-kart/packages/frontend/dist

# Copy the compiled core + the files the emulator host stages into MEMFS at
# runtime (loadFile reads these), relative to the inner-monorepo root.
ARG ASSETS=/app/packages/discord-plays-mario-kart/packages/backend/assets/n64wasm
COPY --from=wasm-builder /src/code/n64wasm.js        ${ASSETS}/n64wasm.js
COPY --from=wasm-builder /src/code/n64wasm.wasm      ${ASSETS}/n64wasm.wasm
COPY --from=wasm-builder /src/code/shader_vert.hlsl  ${ASSETS}/shader_vert.hlsl
COPY --from=wasm-builder /src/code/shader_frag.hlsl  ${ASSETS}/shader_frag.hlsl
COPY --from=wasm-builder /src/code/overlay.png       ${ASSETS}/overlay.png
COPY --from=wasm-builder /src/code/res/arial.ttf     ${ASSETS}/res/arial.ttf

# Version/revision metadata as build args so CI can bake the real build number +
# commit SHA (`--build-arg VERSION=… --build-arg GIT_SHA=…`); the `dev`/`unknown`
# defaults keep a plain `docker run` bootable.
ENV NODE_ENV=production
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}

# Run from the inner-monorepo root so getConfig()/emulator resolve config.toml,
# the n64wasm assets, and saves/ relative to CWD. Apply the leaderboard schema
# to the (persistent-volume) SQLite DB before start — idempotent, birmel-style;
# harmless when leaderboards are disabled. Prisma 7's `db push` no longer accepts
# `--skip-generate`, so it is omitted (generate ran at build time above).
# `prisma` is a runtime dependency of the backend, so `bunx` resolves it from
# the installed tree without a network fetch.
WORKDIR /app/packages/discord-plays-mario-kart
USER 1000:1000
ENV HOME=/tmp
CMD ["sh", "-c", "cd packages/backend && bun x --no-install prisma db push && cd /app/packages/discord-plays-mario-kart && exec bun packages/backend/src/index.ts"]

FROM runtime AS smoke
# This stage temporarily needs root only to assemble the smoke harness and its
# writable config fixture. It drops back to the deploy UID before execution.
USER root
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=discord-plays-mario-kart
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# The smoke harness writes its temporary config at the application's normal
# CWD. Prepare that file while this stage is still root, then let the deploy
# uid replace its contents during the actual smoke.
RUN touch /app/packages/discord-plays-mario-kart/config.toml \
  && chown 1000:1000 /app/packages/discord-plays-mario-kart/config.toml
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
