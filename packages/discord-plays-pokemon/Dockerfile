# syntax=docker/dockerfile:1.7-labs@sha256:b99fecfe00268a8b556fad7d9c37ee25d716ae08a5d7320e6d51c4dd83246894
# Headless Discord Plays Pokémon. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in packages/discord-plays-pokemon/packages/backend
# (which passes `-f ../../Dockerfile ../../../..`).
#
# Runs pokeemerald-wasm entirely in Bun, renders frames in software, and streams
# to Discord over the voice UDP path. No X server, no browser, no GPU.

# ---------------------------------------------------------------------------
# Stage 1 — build pokeemerald.wasm from source.
# ottohg/pokeemerald-wasm at a pinned commit + our checked-in export patch.
# The committed asset is gitignored, so it MUST be produced here (mirrors the
# removed Dagger `buildPokeemeraldWasm` and scripts/build-wasm.sh). The build
# uses clang wasm32-unknown-unknown + wasm-ld (LLVM, NOT emscripten): trixie's
# clang-19 produces a Bun-loadable binary (bookworm's clang-14 does not).
# ---------------------------------------------------------------------------
FROM debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd AS wasm-builder

# Pinned commit of ottohg/pokeemerald-wasm. Kept in sync with the OTTOHG_SHA in
# packages/discord-plays-pokemon/scripts/build-wasm.sh (the single source of
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
# mirrors scripts/build-wasm.sh.
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
# Stage 2 — the headless Bun runtime.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS runtime

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
# world-readable bin on PATH. Kept ABOVE the manifest/source layers: it needs
# only bun + network, and a source edit must not re-download it.
ENV BUN_INSTALL=/usr/local
RUN bun add -g @openai/codex@0.139.0 && codex --version

# Manifests-only install layer: install the Pokémon backend, common package,
# frontend, and their complete workspace dependency closure. This keeps the
# later frontend and dist-producing dependency builds available without
# installing unrelated applications, and only invalidates on
# manifest/lockfile/patch changes.
# trustedDependencies (node-datachannel, node-av, sharp) run their native
# postinstalls during the frozen install. `--frozen-lockfile` requires every
# workspace member's package.json present, so the globs enumerate all 47 members
# (top-level, nested packages/*/packages/*, homelab/src/*, the desktop src-tauri
# crate, and the `scripts` dir).
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@discord-plays-pokemon/*'

# Now the sources. node_modules is excluded from context by .dockerignore, so
# this does not clobber the installed tree.
COPY . .

# Build the workspace deps whose package `main`/exports resolve to a gitignored
# `dist/` — consumers crash at startup with `Cannot find module` otherwise.
# discord-stream-lifecycle is load-bearing (consumed as compiled JS from the
# nested backend); llm-models' catalog resolves to dist too.
RUN cd packages/discord-stream-lifecycle && bun run build \
  && cd /app/packages/llm-models && bun run build

# Make the goal-mode control CLI available to operators and spawned Codex loops.
RUN install -D -m 0755 \
    packages/discord-plays-pokemon/packages/backend/src/goal/pokemonctl.ts \
    /usr/local/bin/pokemonctl \
  && pokemonctl --help

# Stage the from-source wasm where the emulator expects it (relative to the
# inner-monorepo root the app runs from).
COPY --from=wasm-builder /src/build/wasm/pokeemerald.wasm \
  /app/packages/discord-plays-pokemon/packages/backend/assets/pokeemerald.wasm

# Build the web UI served by the backend (web.assets). Expose the release to
# Vite BEFORE the build so the SPA's Sentry.init tags events with `release`.
ENV VITE_SENTRY_RELEASE=dev
RUN cd packages/discord-plays-pokemon/packages/frontend && bun run build

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
# packages/backend/assets/pokeemerald.wasm, and saves/ relative to CWD.
WORKDIR /app/packages/discord-plays-pokemon
CMD ["bun", "packages/backend/src/index.ts"]
