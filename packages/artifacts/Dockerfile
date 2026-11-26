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
  '@shepherdjerred/artifacts'

FROM base AS deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/artifacts'

# Add each workspace dependency's directory to this COPY and to the runtime
# stage's as the service gains them.
FROM deps AS build
COPY --parents tsconfig.base.json packages/artifacts packages/eslint-config ./
RUN cd packages/artifacts && bun run build

FROM base AS prod-deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/artifacts'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

FROM base AS runtime
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
COPY --from=build --exclude=node_modules /app/packages/artifacts /app/packages/artifacts
WORKDIR /app/packages/artifacts
# The Bugsink release; declared after the build steps so it never busts caches.
ARG VERSION=dev
ENV VERSION=${VERSION}
ENV NODE_ENV=production HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7440
USER 1000:1000
CMD ["bun", "src/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=artifacts
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# The service boots without reaching its database, object store or Flags, and
# answers /healthz on the internal host class: the smoke's Host (127.0.0.1)
# must differ from both origins below.
ENV DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:15432/artifacts \
    S3_ENDPOINT=http://127.0.0.1:19000 \
    AWS_ACCESS_KEY_ID=smoke AWS_SECRET_ACCESS_KEY=smoke \
    ARTIFACTS_APP_ORIGIN=http://artifacts.smoke.test \
    ARTIFACTS_CONTENT_ORIGIN=http://artifacts-content.smoke.test \
    ARTIFACTS_OPERATOR_LOGINS=smoke@example.test \
    ENVIRONMENT=test FEATURE_FLAGS_MODE=disabled
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
