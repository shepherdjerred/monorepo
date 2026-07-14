# temporal-worker image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
#
# NOTE: the old Dagger temporal-worker image also baked in a large fleet of
# operator CLIs (gh, claude, codex, kubectl, github-mcp-server, talosctl, tofu,
# argocd, velero, bk, temporal, cog) needed by the worker's PR-agent /
# homelab-audit / readme-refresh workflows. Those are intentionally NOT
# reproduced here yet — this image covers the worker boot + Temporal-connect
# smoke path. Re-adding the CLI layers is tracked as a follow-up (see report).
FROM oven/bun:1.3.14 AS base
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile

# llm-models' package `main`/`exports` resolve to a gitignored `dist/`, so a
# consumer that imports it (temporal's pr-review cost activity) crashes at
# startup with `Cannot find module '@shepherdjerred/llm-models'` unless the
# catalog is compiled first. (home-assistant and llm-observability export their
# `src/` directly and need no build.) Mirrors the old Dagger `withBuiltLlmModels`.
RUN cd packages/llm-models && bun run build

# The worker imports `#generated/ha-schema.ts` (type-only, but keep the file
# present so any runtime `import` resolves). ensure-ha-schema copies the
# committed stub into place if a generated schema isn't present. Idempotent.
RUN bun packages/temporal/scripts/ensure-ha-schema.ts

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Point Bun's runtime install cache at a writable path (the base sets
# BUN_INSTALL=/usr/local, whose install/cache is root-owned) — mirrors the old
# Dagger image's BUN_INSTALL_CACHE_DIR fix.
ENV BUN_INSTALL_CACHE_DIR=/tmp/bun-install-cache

# Run from the package dir so Bun resolves this package's tsconfig + imports map
# (the `#generated/*`, `#activities/*`, … subpath imports).
WORKDIR /app/packages/temporal
CMD ["bun", "src/worker.ts"]
