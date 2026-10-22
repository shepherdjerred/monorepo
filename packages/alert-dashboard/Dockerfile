# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
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
  '@shepherdjerred/alert-dashboard'

FROM base AS deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/alert-dashboard'

FROM deps AS build
# `@shepherdjerred/loaded` and the ops packages export TypeScript source rather
# than a built dist, so having their package.json present for the install is
# not enough — the client build has to be able to read the files their export
# maps point at.
COPY --parents \
  tsconfig.base.json \
  packages/alert-dashboard \
  packages/eslint-config \
  packages/loaded \
  packages/ops-model \
  packages/ops-clients \
  packages/config \
  packages/feature-flags \
  ./
RUN cd packages/alert-dashboard && bun run build

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
# the source here those symlinks dangle in the runtime image.
COPY --parents \
  packages/loaded \
  packages/ops-model \
  packages/ops-clients \
  packages/config \
  packages/feature-flags \
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
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7341
USER 1000:1000
CMD ["bun", "src/server/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
COPY ci/scripts/images/smoke-app-configs.ts /app/ci/scripts/images/smoke-app-configs.ts
ARG SMOKE_TARGET=alert-dashboard
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Exercise Prisma as the deployed non-root user so a missing baked engine fails
# the image gate instead of crash-looping the migration init container.
RUN cd /app/packages/alert-dashboard && bunx --no-install prisma --version
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
