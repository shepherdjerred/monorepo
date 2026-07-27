# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# starlight-karma-bot image. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker). Built via `bun run docker:build`
# in this package (which passes `-f Dockerfile ../..`).
#
# Multi-stage: prod-deps installs the production-only dependency closure from
# the workspace manifests; runtime COPYs that tree plus the scoped source
# closure and never runs `bun install`. Dev dependencies and the rest of the
# monorepo source never reach the final image, and the source layer only
# invalidates when this package changes — not on every repo commit.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# ── prod-deps: production-only node_modules, cached on manifests ────────────
# `--frozen-lockfile` requires every workspace member's package.json present,
# so the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter 'starlight-karma-bot'

# ── runtime: COPY-only — no install, no build tooling, no network ───────────
FROM base AS runtime
# The isolated-linker tree uses relative symlinks (store at node_modules/.bun),
# so copying the whole install root between same-rooted stages is safe. Kept
# BEFORE the source COPY so a source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/
# Scoped source closure (no runtime workspace deps); root tsconfig kept for
# uniformity with the other app images.
COPY --parents \
  tsconfig.base.json \
  packages/starlight-karma-bot \
  ./

# Version/revision metadata — starlight's config requires VERSION and GIT_SHA
# at boot.
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

# Run as the non-root `bun` user shipped in the base image. The COPY'd
# node_modules tree is root-owned but read-only at runtime.
USER bun

# Run from the package dir so Bun picks up this package's tsconfig
# (experimentalDecorators + emitDecoratorMetadata, required by TypeORM entities).
WORKDIR /app/packages/starlight-karma-bot
CMD ["bun", "src/index.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=starlight-karma-bot
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
