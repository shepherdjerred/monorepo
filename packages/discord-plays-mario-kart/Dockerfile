# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
# Headless Discord Plays Mario Kart. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in packages/discord-plays-mario-kart/packages/backend
# (which passes `-f ../../Dockerfile ../../../..`).
#
# Runs the native SpaghettiKart port of MK64 as a child process, rendering with
# OpenGL through Mesa (the iGPU when present, llvmpipe otherwise), and streams
# its frames to Discord over the voice UDP path. No X server, no browser.
#
# Multi-stage on the Bun side too: deps does a full (dev-inclusive) install to
# feed the dist/Prisma/frontend builds; prod-deps installs the production-only
# backend closure; runtime COPYs the prod tree, the scoped source closure, the
# compiled core, and the built artifacts — it never runs `bun install`. Dev
# dependencies and the rest of the monorepo source never reach the final
# image, and the source layer only invalidates when a closure package changes —
# not on every repo commit.

# ---------------------------------------------------------------------------
# Stage 1 — compile the game: the native SpaghettiKart port.
# The pinned upstream commit (spaghetti-src/upstream.json) is cloned and our
# host-bridge patches are applied, exactly the inputs and steps of
# scripts/build-spaghetti.ts, which builds the same thing locally. The upstream
# source is never committed. Built on the runtime's base image so the binary
# links against the libraries the runtime installs below.
#
# Not Renovate-managed on purpose: a new pin needs the patch series regenerated
# against it (spaghetti-src/PATCHES.md), so bumps are deliberate edits.
#
# Only build output leaves this stage. The ROM-derived mk64.o2r is NOT built
# here: the backend extracts it from the ROM volume at startup, into the saves
# volume, with the Torch binary and inputs staged below.
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS spaghetti-builder

# Toolchain plus the libraries upstream's Linux build takes from the system.
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Acknowledged per-site so a NEW unpinned install
# still fails.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates git patch jq g++ cmake ninja-build pkg-config python3 \
    libsdl2-dev libsdl2-net-dev libpng-dev libzip-dev zipcmp zipmerge ziptool \
    nlohmann-json3-dev libtinyxml2-dev libspdlog-dev libfmt-dev libboost-dev \
    libopengl-dev libgl-dev libegl-dev libglew-dev libogg-dev libvorbis-dev \
    libbz2-dev zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
COPY packages/discord-plays-mario-kart/spaghetti-src /spaghetti-src
WORKDIR /src
RUN repo="$(jq -r .repository /spaghetti-src/upstream.json)" \
  && commit="$(jq -r .commit /spaghetti-src/upstream.json)" \
  && git init -q . \
  && git remote add origin "$repo" \
  && git fetch -q --depth=1 origin "$commit" \
  && git checkout -q --detach FETCH_HEAD \
  && jq -r '.submodules[]' /spaghetti-src/upstream.json \
    | xargs git submodule update --init --depth 50 \
  && for p in /spaghetti-src/patches/*.patch; do \
    echo "applying $p"; patch -p1 --no-backup-if-mismatch < "$p"; \
  done

# GenerateO2R builds spaghetti.o2r (the port's own assets, from source); on
# Linux it is not a dependency of the default target.
RUN cmake -H. -Bbuild -GNinja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DENABLE_VCPKG=OFF \
  && cmake --build build \
  && cmake --build build --target GenerateO2R

# The install the backend loads (engine/spaghetti/install.ts): the game, its
# engine archive, Torch, Torch's extraction inputs, the name-label font
# (Montserrat, SIL OFL, from the port's own assets), and install.json.
RUN mkdir -p /out/torch-inputs/include /out/torch-inputs/meta /out/fonts \
  && cp build/Spaghettify build/spaghetti.o2r /out/ \
  && cp build/TorchExternal/src/TorchExternal-build/torch /out/torch \
  && strip --strip-unneeded /out/Spaghettify /out/torch \
  && cp -r config.yml yamls /out/torch-inputs/ \
  && cp include/defines.h /out/torch-inputs/include/ \
  && cp meta/mods.toml /out/torch-inputs/meta/ \
  && cp assets/fonts/Montserrat-Regular.ttf /out/fonts/ \
  && jq -n \
    --arg commit "$(git rev-parse HEAD)" \
    --arg romSha1 "$(jq -r .romSha1 /spaghetti-src/upstream.json)" \
    '{binary: "Spaghettify", engineArchive: "spaghetti.o2r", torch: "torch", torchInputs: "torch-inputs", labelFont: "fonts/Montserrat-Regular.ttf", commit: $commit, romSha1: $romSha1}' \
    > /out/install.json

# ---------------------------------------------------------------------------
# Bun stages.
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
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
  packages/discord-video-stream/prebuilds-patched/ \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
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
  packages/sentry-config \
  packages/discord-stream-lifecycle \
  packages/discord-video-stream \
  packages/loaded \
  ./
# discord-stream-lifecycle's package resolves to a gitignored `dist/`; consumed
# as compiled JS from the nested backend, it must be built or the app crashes at
# startup with `Cannot find module '@shepherdjerred/discord-stream-lifecycle'`.
RUN cd packages/discord-stream-lifecycle && bun run build
# The common package's browser-safe entry point is a bundle so its validated
# HUD JSON catalog ships with both the backend and frontend consumers.
RUN cd packages/discord-plays-mario-kart/packages/common && bun run build
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
  packages/discord-video-stream/prebuilds-patched/ \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
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
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN set -e; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then sed -i "s/^Components: main.*/Components: main contrib non-free non-free-firmware/" /etc/apt/sources.list.d/debian.sources; fi; \
  apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libvips42 fontconfig ca-certificates libva2 libva-drm2 vainfo \
  && if [ "$(dpkg --print-architecture)" = "amd64" ]; then apt-get install -y --no-install-recommends intel-media-va-driver-non-free; fi \
  && rm -rf /var/lib/apt/lists/*

# SpaghettiKart's runtime libraries: what the spaghetti-builder stage links
# against, plus Mesa's EGL and DRI drivers so the
# game renders offscreen with no window system (iris on the iGPU render node,
# llvmpipe without one). Its own layer, so the ffmpeg/VAAPI layer above is
# unaffected. smoke:spaghetti-install checks that every library resolves.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libsdl2-2.0-0 libopengl0 libzip5 libtinyxml2-11 libspdlog1.15 libfmt10 \
    libgl1 libegl1 libegl-mesa0 libgl1-mesa-dri libgbm1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production node_modules + workspace manifests. The isolated-linker tree uses
# relative symlinks (store at node_modules/.bun), so copying the whole install
# root between same-rooted stages is safe. Kept BEFORE the source COPY so a
# source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/

# Scoped source closure. spaghetti-src and the frontend source are build inputs
# only — the compiled game and the built web UI are COPY'd from their stages
# below.
COPY --parents \
  tsconfig.base.json \
  packages/discord-plays-mario-kart/config.example.toml \
  packages/discord-plays-mario-kart/packages/backend \
  packages/discord-plays-mario-kart/packages/common \
  packages/discord-plays-core \
  packages/sentry-config \
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
COPY --from=build /app/packages/discord-plays-mario-kart/packages/common/dist packages/discord-plays-mario-kart/packages/common/dist
COPY --from=build /app/packages/discord-plays-mario-kart/packages/backend/generated packages/discord-plays-mario-kart/packages/backend/generated
COPY --from=build /app/packages/discord-plays-mario-kart/packages/frontend/dist packages/discord-plays-mario-kart/packages/frontend/dist

# The SpaghettiKart install (game, spaghetti.o2r, Torch and its inputs,
# install.json) at [spaghettikart] install_dir's default. Build output only:
# the ROM-derived mk64.o2r is extracted at startup into the saves volume.
COPY --from=spaghetti-builder /out packages/discord-plays-mario-kart/packages/backend/assets/spaghettikart

# Version/revision metadata as build args so CI can bake the real build number +
# commit SHA (`--build-arg VERSION=… --build-arg GIT_SHA=…`); the `dev`/`unknown`
# defaults keep a plain `docker run` bootable.
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}

# Run from the inner-monorepo root so getConfig() and the engine resolve
# config.toml, the SpaghettiKart install, and saves/ relative to CWD. Apply the leaderboard schema
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
# This stage temporarily needs root (uid 0, numeric for DL3066) only to
# assemble the smoke harness and its writable config fixture. It drops back to
# the deploy UID before execution.
USER 0
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
COPY ci/scripts/images/smoke-app-configs.ts /app/ci/scripts/images/smoke-app-configs.ts
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
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
