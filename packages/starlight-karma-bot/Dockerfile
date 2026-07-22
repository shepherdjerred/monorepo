# syntax=docker/dockerfile:1.7-labs@sha256:b99fecfe00268a8b556fad7d9c37ee25d716ae08a5d7320e6d51c4dd83246894
# starlight-karma-bot image. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker). Built via `bun run docker:build`
# in this package (which passes `-f Dockerfile ../..`).
#
# Replaces the old per-package `COPY package.json bun.lock` + `bun install` stage:
# that world (per-package lockfiles / file: deps) is gone. We COPY every
# workspace manifest for frozen-lockfile validation, then install only this app
# and its workspace dependency closure.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# Manifests-only filtered install layer only invalidates when a
# manifest/lockfile/patch changes, not on every source edit.
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
RUN bun install --frozen-lockfile --filter 'starlight-karma-bot'

# Now the sources. node_modules is excluded from context by .dockerignore, so
# this does not clobber the installed tree.
COPY . .

# Version/revision metadata — the old buildImageHelper injected these as ENV +
# OCI labels. starlight's config requires VERSION and GIT_SHA at boot.
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# The bot exposes a health server (default 8000; see src/health.ts).
EXPOSE 8000

# Health check reuses the in-repo health probe (unchanged from the old image).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run packages/starlight-karma-bot/src/health.ts || exit 1

# Run as the non-root `bun` user shipped in the base image.
USER bun

# Run from the package dir so Bun picks up this package's tsconfig
# (experimentalDecorators + emitDecoratorMetadata, required by TypeORM entities).
WORKDIR /app/packages/starlight-karma-bot
CMD ["bun", "src/index.ts"]
