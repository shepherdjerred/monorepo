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
FROM emscripten/emsdk:2.0.7 AS wasm-builder

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
FROM oven/bun:1.3.14 AS runtime

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

# Copy the whole workspace and install once at the root against the single
# lockfile. trustedDependencies (node-datachannel, node-av, sharp) run their
# native postinstalls during the frozen install. The root .dockerignore keeps
# node_modules/dist/.git out of context.
COPY . .
RUN bun install --frozen-lockfile

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

ENV NODE_ENV=production
ENV VERSION=dev
ENV GIT_SHA=unknown

# Run from the inner-monorepo root so getConfig()/emulator resolve config.toml,
# the n64wasm assets, and saves/ relative to CWD. Apply the leaderboard schema
# to the (persistent-volume) SQLite DB before start — idempotent, birmel-style;
# harmless when leaderboards are disabled. Prisma 7's `db push` no longer accepts
# `--skip-generate`, so it is omitted (generate ran at build time above).
WORKDIR /app/packages/discord-plays-mario-kart
CMD ["sh", "-c", "cd packages/backend && bunx prisma db push && cd /app/packages/discord-plays-mario-kart && exec bun packages/backend/src/index.ts"]
