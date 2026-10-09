# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
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
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/woodpecker-config-extension'

FROM prod-deps AS review-build
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/root-scripts'
COPY --parents scripts/lib/ scripts/review/ packages/code-review/ ./
RUN bun build scripts/review/bundled-review-gate.ts --target bun --outfile /review-gate.js

FROM base AS runtime
# Both the service and its checkout-free gate use this trusted image. The
# generated workflow wraps commands with bash and GNU timeout.
# hadolint ignore=DL3008
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends bash coreutils git ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/ /app/
COPY --from=review-build /review-gate.js /app/review-gate.js
COPY --parents \
  tsconfig.base.json \
  packages/version-catalog/src \
  packages/config/src packages/feature-flags/src \
  packages/woodpecker-config-extension \
  ./

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
ENV HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

EXPOSE 3000
USER 1000:1000
CMD ["bun", "packages/woodpecker-config-extension/src/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
COPY ci/scripts/images/smoke-app-configs.ts /app/ci/scripts/images/smoke-app-configs.ts
ARG SMOKE_TARGET=woodpecker-config-extension
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
