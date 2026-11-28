# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS base
WORKDIR /app

# ── manifests: the install closure's manifests and projected lockfile ───────
# Every manifest, bun.lock and patch reaches this cheap stage; installs copy only
# its output (the closure's manifests plus root package.json, bun.lock and
# patches projected onto the closure), so a change outside the closure keeps
# their cache keys and layers.
FROM base AS manifests
COPY --parents \
  package.json bun.lock patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  /workspace/
COPY --parents \
  ci/scripts/images/workspace-manifests.ts \
  ci/scripts/images/install-projection/install-projection.ts \
  ci/scripts/selectors/select-image-targets-workspaces.ts \
  ci/scripts/selectors/select-image-targets-lockfile.ts \
  /tools/
RUN bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure \
  '@shepherdjerred/golink'

FROM base AS deps
COPY --parents bunfig.toml ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/golink'

FROM deps AS build
# console-ui, console-client and ops-model export TypeScript source the client
# build bundles; they are devDependencies, so the runtime image never needs them.
COPY --parents tsconfig.base.json packages/golink packages/console-ui packages/console-client packages/console-server packages/ops-model packages/config packages/feature-flags packages/bugsink-config packages/eslint-config packages/homelab/src/platform-model.json ./
RUN cd packages/golink && bun run generate && bun run build

FROM base AS prod-deps
COPY --parents bunfig.toml ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/golink'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

FROM base AS runtime
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
COPY --from=build --exclude=node_modules /app/packages/golink /app/packages/golink
COPY --parents packages/config packages/console-server packages/feature-flags packages/bugsink-config packages/homelab/src/platform-model.json ./
# Prisma's CLI records per-run state under $HOME; keep it out of the layer.
RUN cd packages/golink && CHECKPOINT_DISABLE=1 bunx --no-install --trust prisma generate \
 && rm -rf "$HOME/.cache/checkpoint-nodejs" "$HOME/.config/prisma-nodejs"
WORKDIR /app/packages/golink
# The Bugsink release; declared after the build steps so it never busts caches.
ARG VERSION=dev
ENV VERSION=${VERSION}
ENV NODE_ENV=production HOME=/tmp
# The Prisma CLI runs at container start (migrations); keep its update-check
# telemetry (checkpoint.prisma.io) off so it never attempts denied egress.
ENV CHECKPOINT_DISABLE=1
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7352
USER 1000:1000
CMD ["bun", "src/server/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=golink
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bunx --no-install prisma --version && \
    bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
