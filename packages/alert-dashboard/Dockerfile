# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

FROM base AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/alert-dashboard'

FROM deps AS build
COPY --parents tsconfig.base.json packages/alert-dashboard packages/eslint-config ./
RUN cd packages/alert-dashboard && bun run build

FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/alert-dashboard'

FROM base AS runtime
COPY --from=prod-deps /app/ /app/
COPY --from=build /app/packages/alert-dashboard /app/packages/alert-dashboard
# Bake Prisma's migration engines into the production dependency tree. Bun's
# production install omits lifecycle scripts, so the CLI would otherwise
# download engines on first use. Runtime executes as uid 1000 over root-owned
# node_modules, which correctly prevents that startup write. Generating once as
# root here keeps `prisma migrate deploy` read-only at runtime.
RUN cd packages/alert-dashboard && bunx --no-install --trust prisma generate
ENV NODE_ENV=production HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7341
USER 1000:1000
CMD ["bun", "packages/alert-dashboard/src/server/index.ts"]

FROM runtime AS smoke
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=alert-dashboard
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Exercise Prisma as the deployed non-root user so a missing baked engine fails
# the image gate instead of crash-looping the migration init container.
RUN cd /app/packages/alert-dashboard && bunx --no-install prisma --version
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
