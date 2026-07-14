# trmnl-dashboard image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
FROM oven/bun:1.3.14 AS base
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile

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
