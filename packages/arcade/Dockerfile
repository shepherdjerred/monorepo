# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
# Build with `docker buildx bake arcade`: native game stages are named contexts.
# No disc dumps, translated WASM, or extracted game assets enter this image.
ARG SPAGHETTI_CONTEXT=arcade-spaghetti
ARG DOLPHIN_CONTEXT=arcade-dolphin
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

FROM base AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/discord-video-stream/prebuilds-patched/ \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json ./
RUN bun install --frozen-lockfile --filter '@arcade/*'

FROM deps AS build
COPY --parents tsconfig.base.json \
  packages/arcade/packages packages/config packages/feature-flags packages/eslint-config \
  packages/discord-plays-core packages/discord-plays-web \
  packages/discord-plays-mario-kart/packages/backend \
  packages/discord-plays-mario-kart/packages/common \
  packages/discord-plays-pokemon/packages/backend \
  packages/discord-plays-pokemon/packages/common \
  packages/discord-stream-lifecycle packages/discord-video-stream \
  packages/llm-models packages/llm-observability packages/s3-signed-request \
  packages/bugsink-config packages/text ./
RUN cd packages/discord-stream-lifecycle && bun run build
RUN cd packages/llm-models && bun run build
RUN cd packages/discord-plays-mario-kart/packages/common && bun run build
RUN cd packages/discord-plays-mario-kart/packages/backend && bunx --trust prisma generate
RUN cd packages/arcade/packages/common && bun run build
RUN cd packages/eslint-config && bun run build
RUN cd packages/arcade/packages/frontend && bun run build

FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/discord-video-stream/prebuilds-patched/ \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json ./
RUN bun install --frozen-lockfile --production --filter '@arcade/backend'

FROM ${SPAGHETTI_CONTEXT} AS native-spaghetti
FROM ${DOLPHIN_CONTEXT} AS native-dolphin

FROM base AS runtime
# Debian archives remove superseded patch releases. Intel VAAPI is amd64-only.
# hadolint ignore=DL3008
RUN sed -i 's/^Components: main.*/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium ffmpeg libvips42 fontconfig ca-certificates libva2 libva-drm2 \
    intel-media-va-driver-non-free libvulkan1 mesa-vulkan-drivers \
    libsdl2-2.0-0 libopengl0 libzip5 libtinyxml2-11 libspdlog1.15 libfmt10 \
    libgl1 libegl1 libegl-mesa0 libgl1-mesa-dri libgbm1 \
    libudev1 libevdev2 libusb-1.0-0 libhidapi-hidraw0 libhidapi-libusb0 \
    libcurl4t64 liblzma5 libbz2-1.0 libzstd1 liblzo2-2 libpng16-16t64 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/ /app/
COPY --parents tsconfig.base.json \
  packages/arcade/config.example.toml packages/arcade/packages/backend \
  packages/arcade/packages/common packages/config packages/feature-flags \
  packages/discord-plays-core \
  packages/discord-plays-mario-kart/packages/backend \
  packages/discord-plays-mario-kart/packages/common \
  packages/discord-plays-pokemon/packages/backend \
  packages/discord-plays-pokemon/packages/common \
  packages/discord-plays-pokemon/AGENTS.md packages/discord-plays-pokemon/knowledge \
  packages/discord-plays-pokemon/.agents \
  packages/discord-stream-lifecycle packages/discord-video-stream \
  packages/llm-models packages/llm-observability packages/s3-signed-request \
  packages/bugsink-config packages/text ./
RUN cd packages/discord-plays-mario-kart/packages/backend && bunx --trust prisma generate
COPY --from=build /app/packages/discord-stream-lifecycle/dist packages/discord-stream-lifecycle/dist
COPY --from=build /app/packages/llm-models/dist packages/llm-models/dist
COPY --from=build /app/packages/discord-plays-mario-kart/packages/common/dist packages/discord-plays-mario-kart/packages/common/dist
COPY --from=build /app/packages/discord-plays-mario-kart/packages/backend/generated packages/discord-plays-mario-kart/packages/backend/generated
COPY --from=build /app/packages/arcade/packages/common/dist packages/arcade/packages/common/dist
COPY --from=build /app/packages/arcade/packages/frontend/dist packages/arcade/packages/frontend/dist
COPY --from=native-spaghetti /out packages/discord-plays-mario-kart/packages/backend/assets/spaghettikart
COPY --from=native-dolphin /opt/dolphin /opt/dolphin
RUN install -D -m 0755 packages/discord-plays-pokemon/packages/backend/src/goal/control/pokemonctl-entrypoint.sh /usr/local/bin/pokemonctl \
  && install -D -m 0644 packages/discord-plays-pokemon/packages/backend/src/goal/control/pokemonctl-output.ts /usr/local/bin/pokemonctl-output.ts \
  && ldd /opt/dolphin/bin/dolphin-emu-nogui > /tmp/dolphin-libraries \
  && cat /tmp/dolphin-libraries \
  && ! grep -q 'not found' /tmp/dolphin-libraries
ENV NODE_ENV=production
ENV POKEMON_KNOWLEDGE_ROOT=/app/packages/discord-plays-pokemon/knowledge
ENV HOME=/tmp
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
WORKDIR /app/packages/arcade
USER 1000:1000
CMD ["bun", "packages/backend/src/index.ts"]

FROM runtime AS smoke
RUN test -s packages/common/dist/browser/browser.js \
  && test -s packages/frontend/dist/index.html \
  && test -x /opt/dolphin/bin/dolphin-emu-nogui \
  && chromium --version \
  && cd packages/backend \
  && bun -e 'await import("@arcade/common/catalog.ts"); await import("@discord-plays-mario-kart/backend/database/index.ts"); await import("@discord-plays-pokemon/backend/lifecycle/pokemon-driver.ts");'

FROM runtime AS image
