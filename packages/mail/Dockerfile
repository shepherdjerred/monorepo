# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
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
  '@shepherdjerred/mail'

FROM base AS deps
COPY --parents bunfig.toml ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/mail'

FROM deps AS build
COPY --parents tsconfig.base.json packages/mail packages/console-ui packages/eslint-config packages/feature-flags packages/ops-model ./
RUN cd packages/mail && bun run build

FROM base AS prod-deps
COPY --parents bunfig.toml ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/mail'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

FROM base AS runtime
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
COPY --from=build --exclude=node_modules /app/packages/mail /app/packages/mail
COPY --parents packages/feature-flags packages/ops-model ./
WORKDIR /app/packages/mail
ARG VERSION=dev
ENV VERSION=${VERSION}
ENV NODE_ENV=production HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7370 7371 25
USER 1000:1000
CMD ["bun", "src/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=mail
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
