# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# trmnl-dashboard image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# Manifests-only install layer: install trmnl-dashboard and its complete
# workspace dependency closure (including home-assistant), rather than
# materializing unrelated applications. This layer only invalidates when a
# manifest/lockfile/patch changes.
# `--frozen-lockfile` requires every workspace member's package.json present, so
# the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/trmnl-dashboard'

# Now the sources. node_modules is excluded from context by .dockerignore, so
# this does not clobber the installed tree.
COPY . .

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Bun.serve binds on port 3000 (config default).
EXPOSE 3000

# Ran as UID 1000 in the old recipe — the base image's non-root `bun` user is UID 1000.
USER bun

# Run from the package dir so Bun resolves this package's tsconfig / imports map.
WORKDIR /app/packages/trmnl-dashboard
CMD ["bun", "src/index.ts"]

FROM base AS smoke
ARG SMOKE_TARGET=trmnl-dashboard
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM base AS image
