# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS base
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
  '@shepherdjerred/brim-service'

FROM base AS deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/brim-service'

FROM deps AS build
COPY --parents tsconfig.base.json packages/brim-service packages/toolkit packages/llm-models packages/config packages/ops-model packages/mc-harness packages/eslint-config ./
RUN cd packages/brim-service && bun run build

FROM base AS runtime
COPY --from=build /app/packages/brim-service/dist /app/packages/brim-service/dist
WORKDIR /app/packages/brim-service
# The Bugsink release; declared after the build steps so it never busts caches.
ARG VERSION=dev
ENV VERSION=${VERSION}
ENV NODE_ENV=production HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7458
USER 1000:1000
CMD ["bun", "dist/index.js"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=brim-service
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
