# syntax=docker/dockerfile:1.7-labs@sha256:b99fecfe00268a8b556fad7d9c37ee25d716ae08a5d7320e6d51c4dd83246894
# Headless Discord Plays Mario Kart. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in packages/discord-plays-mario-kart/packages/backend
# (which passes `-f ../../Dockerfile ../../../..`).
#
# Runs the N64Wasm core (parallel-n64 + angrylion software RDP) entirely in Bun,
# renders frames in software, and streams to Discord over the voice UDP path.
# No X server, no browser, no GPU.

# ---------------------------------------------------------------------------
# Stage 1 — compile the N64Wasm core from the vendored source.
# The committed `wasm-src/code` tree is BYTE-PRISTINE upstream; our changes
# (neilSetRom, neilGetVideoBuffer/Height, the per-player input export, the
# Makefile exports) live in `wasm-src/patches/` and are applied here at build
# time. No binaries are committed — the build is reproducible from source.
# Pinned emscripten 2.0.7: the exact toolchain the legacy SDL2/GLES2 core
# compiles with (a newer emsdk silently breaks it). Mirrors the removed Dagger
# `buildDiscordPlaysMarioKartImageHelper` stage 1.
# ---------------------------------------------------------------------------
FROM emscripten/emsdk:2.0.7@sha256:cbeeb7cccd2e7915fe0596345f10bfdec5578cc0386aaa823ad6f1d41910619f AS wasm-builder

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
# Stage 2 — the headless Bun runtime.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS runtime

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

# Manifests-only install layer: install the Mario Kart backend, common package,
# frontend, and their complete workspace dependency closure. This keeps the
# later Prisma/frontend/producer builds available without installing unrelated
# applications, and only invalidates on manifest/lockfile/patch changes.
# trustedDependencies (node-datachannel, node-av, sharp) run their native
# postinstalls during the frozen install. `--frozen-lockfile` requires every
# workspace member's package.json present, so the globs enumerate every member
# (top-level, nested packages/*/packages/*, homelab/src/*, the desktop src-tauri
# crate, and the `scripts` dir).
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@discord-plays-mario-kart/*'

# Now the sources. node_modules is excluded from context by .dockerignore, so
# this does not clobber the installed tree.
COPY . .

# discord-stream-lifecycle's package resolves to a gitignored `dist/`; consumed
# as compiled JS from the nested backend, it must be built or the app crashes at
# startup with `Cannot find module '@shepherdjerred/discord-stream-lifecycle'`.
RUN cd packages/discord-stream-lifecycle && bun run build

# Copy the compiled core + the files the emulator host stages into MEMFS at
# runtime (loadFile reads these), relative to the inner-monorepo root.
ARG ASSETS=/app/packages/discord-plays-mario-kart/packages/backend/assets/n64wasm
COPY --from=wasm-builder /src/code/n64wasm.js        ${ASSETS}/n64wasm.js
COPY --from=wasm-builder /src/code/n64wasm.wasm      ${ASSETS}/n64wasm.wasm
COPY --from=wasm-builder /src/code/shader_vert.hlsl  ${ASSETS}/shader_vert.hlsl
COPY --from=wasm-builder /src/code/shader_frag.hlsl  ${ASSETS}/shader_frag.hlsl
COPY --from=wasm-builder /src/code/overlay.png       ${ASSETS}/overlay.png
COPY --from=wasm-builder /src/code/res/arial.ttf     ${ASSETS}/res/arial.ttf

# Generate the Prisma client for the leaderboard DB (output is gitignored).
RUN cd packages/discord-plays-mario-kart/packages/backend && bunx --trust prisma generate

# Build the web UI served by the backend (web.assets). Expose the release to
# Vite BEFORE the build so the SPA's Sentry.init tags events with `release`.
ENV VITE_SENTRY_RELEASE=dev
RUN cd packages/discord-plays-mario-kart/packages/frontend && bun run build

# Version/revision metadata as build args so CI can bake the real build number +
# commit SHA (`--build-arg VERSION=… --build-arg GIT_SHA=…`); the `dev`/`unknown`
# defaults keep a plain `docker run` bootable. Kept AFTER the frontend build so a
# per-build VERSION doesn't invalidate the (expensive) frontend build layer.
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
WORKDIR /app/packages/discord-plays-mario-kart
CMD ["sh", "-c", "cd packages/backend && bunx prisma db push && cd /app/packages/discord-plays-mario-kart && exec bun packages/backend/src/index.ts"]
