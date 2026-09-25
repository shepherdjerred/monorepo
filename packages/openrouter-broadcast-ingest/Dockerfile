# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/openrouter-broadcast-ingest'

FROM base AS runtime
COPY --from=prod-deps /app/ /app/
COPY --parents \
  tsconfig.base.json \
  packages/llm-models \
  packages/llm-observability \
  packages/s3-signed-request \
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
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
COPY ci/scripts/images/smoke-app-configs.ts /app/ci/scripts/images/smoke-app-configs.ts
ARG SMOKE_TARGET=openrouter-broadcast-ingest
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
