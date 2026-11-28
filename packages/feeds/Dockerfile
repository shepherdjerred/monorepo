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
  '@shepherdjerred/feeds'

FROM base AS deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/feeds'

# Add each workspace dependency's directory to this COPY and to the runtime
# stage's as the service gains them.
FROM deps AS build
COPY --parents tsconfig.base.json packages/feeds packages/feature-flags packages/eslint-config packages/console-ui packages/ops-model ./
RUN cd packages/feeds && bun run generate && bun run build

FROM base AS prod-deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/feeds'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

FROM base AS runtime
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
COPY --from=build --exclude=node_modules /app/packages/feeds /app/packages/feeds
COPY --parents tsconfig.base.json packages/feature-flags ./
# Prisma's CLI records per-run state under $HOME; keep it out of the layer.
RUN cd packages/feeds && CHECKPOINT_DISABLE=1 bunx --no-install --trust prisma generate \
 && rm -rf "$HOME/.cache/checkpoint-nodejs" "$HOME/.config/prisma-nodejs"
WORKDIR /app/packages/feeds
# The Bugsink release; declared after the build steps so it never busts caches.
ARG VERSION=dev
ENV VERSION=${VERSION}
ENV NODE_ENV=production HOME=/tmp
# The Prisma CLI runs at container start (migrations); keep its update-check
# telemetry (checkpoint.prisma.io) off so it never attempts denied egress.
ENV CHECKPOINT_DISABLE=1
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7430 7431
USER 1000:1000
CMD ["bun", "src/index.ts"]

FROM runtime AS smoke
# The smoke migrates a throwaway PostgreSQL and serves from it. The database
# server is installed in this
# stage only; the pushed `image` stage inherits from `runtime` unchanged.
USER 0
# Unpinned on purpose: Debian drops superseded point releases from the archive.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends postgresql postgresql-client && rm -rf /var/lib/apt/lists/*
USER 1000:1000
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=feeds
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bunx --no-install prisma --version && \
    bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
