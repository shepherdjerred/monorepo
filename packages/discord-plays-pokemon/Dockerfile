# Headless Discord Plays Pokémon.
# Replaces the old GPU + desktop + Firefox image: this runs pokeemerald-wasm
# entirely in Bun, renders frames in software, and streams to Discord over the
# voice UDP path. No X server, no browser, no GPU.
FROM oven/bun:1.3.14-debian

# System deps:
# - ffmpeg: used by @dank074/discord-video-stream (fluent-ffmpeg) to encode the
#   rawvideo frame feed to H.264.
# - libvips: native lib for sharp (a transitive dep of discord-video-stream).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libvips42 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for layer caching. The inner monorepo manifests:
COPY package.json bun.lock ./
COPY patches/ patches/
COPY packages/common/package.json packages/common/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

# trustedDependencies in the root package.json lets the native postinstalls
# (node-datachannel, node-av) run during a frozen install. The patch makes
# discord-video-stream lazy-load sharp.
RUN bun install --frozen-lockfile

# App source (includes the vendored packages/backend/assets/pokeemerald.wasm).
COPY . .

# Build the web UI served by the backend (web.assets).
RUN cd packages/frontend && bun run build

# config.toml is provided at runtime (mount or bake a non-secret config).
# The flash save directory is created on demand by the emulator.
ENV NODE_ENV=production
CMD ["bun", "packages/backend/src/index.ts"]
