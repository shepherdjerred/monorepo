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
  '@shepherdjerred/alert-dashboard'

FROM base AS deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/alert-dashboard'

FROM deps AS build
# `@shepherdjerred/loaded`, the ops packages and `@shepherdjerred/console-ui`
# export TypeScript source rather than a built dist, so having their
# package.json present for the install is not enough — the client build has to
# be able to read the files their export maps point at. console-ui is bundled
# into the client, so the runtime stage below does not need it.
COPY --parents \
  tsconfig.base.json \
  packages/alert-dashboard \
  packages/console-ui \
  packages/eslint-config \
  packages/loaded \
  packages/ops-model \
  packages/ops-clients \
  packages/llm-observability \
  packages/llm-models \
  packages/s3-signed-request \
  packages/config \
  packages/feature-flags \
  packages/flags \
  ./
RUN cd packages/alert-dashboard && bun run generate && bun run build

FROM base AS prod-deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/alert-dashboard'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

FROM base AS runtime
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
# Preserve the production install's isolated-linker symlinks. The development
# install can use different peer-context hashes, so copying its node_modules
# over this tree would point at packages that do not exist in prod-deps.
COPY --from=build --exclude=node_modules /app/packages/alert-dashboard /app/packages/alert-dashboard
# These are production dependencies, so the prod install symlinks them; without
# the source here those symlinks dangle in the runtime image. The traces module
# reads the LLM archive index through llm-observability, which in turn imports
# llm-models and s3-signed-request from source.
COPY --parents \
  packages/loaded \
  packages/ops-model \
  packages/ops-clients \
  packages/llm-observability \
  packages/llm-models \
  packages/s3-signed-request \
  packages/config \
  packages/feature-flags \
  packages/flags \
  ./
# Bake Prisma's migration engines into the production dependency tree. Bun's
# production install omits lifecycle scripts, so the CLI would otherwise
# download engines on first use. Runtime executes as uid 1000 over root-owned
# node_modules, which correctly prevents that startup write. Generating once as
# root here keeps `prisma migrate deploy` read-only at runtime.
# Prisma's CLI records per-run state under $HOME; keep it out of the layer.
RUN cd packages/alert-dashboard && CHECKPOINT_DISABLE=1 bunx --no-install --trust prisma generate \
 && rm -rf "$HOME/.cache/checkpoint-nodejs" "$HOME/.config/prisma-nodejs"
WORKDIR /app/packages/alert-dashboard
ENV NODE_ENV=production HOME=/tmp
# The Prisma CLI runs at container start (migrations); keep its update-check
# telemetry (checkpoint.prisma.io) off so it never attempts denied egress.
ENV CHECKPOINT_DISABLE=1
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7341
USER 1000:1000
CMD ["bun", "src/server/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=alert-dashboard
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Exercise Prisma as the deployed non-root user so a missing baked engine fails
# the image gate instead of crash-looping the migration init container.
RUN cd /app/packages/alert-dashboard && bunx --no-install prisma --version
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
