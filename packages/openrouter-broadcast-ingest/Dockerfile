# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/openrouter-broadcast-ingest'

FROM base AS runtime
COPY --from=prod-deps /app/ /app/
COPY --parents \
  tsconfig.base.json \
  packages/llm-models \
  packages/llm-observability \
  packages/openrouter-broadcast-ingest \
  ./
# llm-observability imports the catalog package whose runtime export points at
# gitignored dist files, so compile that production dependency in the image.
RUN cd packages/llm-models && bun run build:runtime

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
ENV HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

EXPOSE 3000 9090
USER 1000:1000
CMD ["bun", "packages/openrouter-broadcast-ingest/src/index.ts"]

FROM runtime AS smoke
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=openrouter-broadcast-ingest
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
