# starlight-karma-bot image. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker). Built via `bun run docker:build`
# in this package (which passes `-f Dockerfile ../..`).
#
# Replaces the old per-package `COPY package.json bun.lock` + `bun install` stage:
# that world (per-package lockfiles / file: deps) is gone. We now COPY the whole
# workspace and run one root `bun install --frozen-lockfile`.
FROM oven/bun:1.3.14 AS base
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile

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
