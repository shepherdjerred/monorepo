# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

# ── manifests: only the install closure's workspace manifests ───────────────
# Every manifest reaches this cheap stage; installs copy only its output, so an
# edit to a package outside the closure keeps their cache keys and layers.
FROM base AS manifests
COPY --parents \
  package.json scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  /workspace/
COPY --parents \
  ci/scripts/images/workspace-manifests.ts \
  ci/scripts/selectors/select-image-targets-workspaces.ts \
  ci/scripts/selectors/select-image-targets-lockfile.ts \
  /tools/
RUN bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure \
  '@shepherdjerred/storm-brain'

FROM base AS prod-deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/storm-brain'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

FROM base AS runtime
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
COPY --parents \
  tsconfig.base.json \
  packages/llm-models \
  packages/llm-runtime \
  packages/llm-observability \
  packages/config \
  packages/s3-signed-request \
  packages/feature-flags \
  packages/storm-brain \
  ./
# llm-runtime imports the catalog package whose runtime export points at
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
CMD ["bun", "packages/storm-brain/src/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=storm-brain
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
