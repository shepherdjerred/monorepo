# Headless Discord Plays Pokémon.
# Replaces the old GPU + desktop + Firefox image: this runs pokeemerald-wasm
# entirely in Bun, renders frames in software, and streams to Discord over the
# voice UDP path. No X server, no browser, no GPU.
FROM oven/bun:1.3.14-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f

# NOTE: The canonical build is the Dagger pipeline (`build-discord-plays-mario-kart-image`), which
# mounts the in-repo fork `@shepherdjerred/discord-video-stream` (a `file:` dep outside this
# directory) into the workspace. A raw `docker build` from this directory cannot resolve that
# out-of-context dependency; this Dockerfile is kept for reference/local iteration only.
#
# System deps:
# - ffmpeg: used by discord-video-stream (fluent-ffmpeg) to encode the
#   rawvideo frame feed to H.264.
# - libvips: native lib for sharp (a transitive dep of discord-video-stream).
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

# Install dependencies first for layer caching. The inner monorepo manifests:
COPY package.json bun.lock ./
COPY packages/common/package.json packages/common/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

# trustedDependencies in the root package.json lets the native postinstalls
# (node-datachannel, node-av) run during a frozen install. discord-video-stream's
# bun-safe lazy `sharp` import is baked into the fork source (no patch needed).
RUN bun install --frozen-lockfile

# App source (includes the vendored packages/backend/assets/pokeemerald.wasm).
COPY . .

# Build the web UI served by the backend (web.assets).
RUN cd packages/frontend && bun run build

# config.toml is provided at runtime (mount or bake a non-secret config).
# The flash save directory is created on demand by the emulator.
ENV NODE_ENV=production
CMD ["bun", "packages/backend/src/index.ts"]
