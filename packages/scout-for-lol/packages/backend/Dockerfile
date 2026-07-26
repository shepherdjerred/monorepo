# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# scout-for-lol backend image. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in this package (which passes `-f Dockerfile ../../../..`).
#
# Multi-stage: deps does a full (dev-inclusive) install to feed the in-image
# llm-models build + prisma generate; prod-deps installs the production-only
# closure; runtime COPYs the prod tree, the scoped source closure, and the
# built artifacts — it never runs `bun install`. Dev dependencies and the rest
# of the monorepo source never reach the final image, and the source layer only
# invalidates when a closure package changes — not on every repo commit.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# ── deps: full install (dev deps) — feeds the artifact builds below ─────────
# `--frozen-lockfile` requires every workspace member's package.json present,
# so the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
FROM base AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@scout-for-lol/backend'

# ── build: gitignored artifacts (llm-models dist + Prisma client) ───────────
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/scout-for-lol/tsconfig.base.json \
  packages/llm-models \
  packages/scout-for-lol/packages/backend \
  ./
# @shepherdjerred/llm-models' package `main`/`types` resolve to a gitignored
# `dist/`, so any consumer (scout's data package imports it) crashes at
# startup with `Cannot find module '@shepherdjerred/llm-models'` unless the
# catalog is compiled first.
RUN cd packages/llm-models && bun run build
# Generate the Prisma client for the backend (output is gitignored, so it must
# be produced in-image). Engines download at build time — that's expected.
# Only `prisma generate` here — the package's full `generate` script also runs
# brand-types + prettier + a test-template DB build, which are dev/test-only.
RUN cd packages/scout-for-lol/packages/backend && bunx --trust prisma generate

# ── prod-deps: production-only node_modules, cached on manifests ────────────
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@scout-for-lol/backend'

# ── runtime: COPY-only — no install, no build tooling, no network ───────────
FROM base AS runtime
# The isolated-linker tree uses relative symlinks (store at node_modules/.bun),
# so copying the whole install root between same-rooted stages is safe. Kept
# BEFORE the source COPY so a source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/
# Scoped source closure (fonts for satori live inside the report package).
COPY --parents \
  tsconfig.base.json \
  packages/scout-for-lol/tsconfig.base.json \
  packages/scout-for-lol/packages/backend \
  packages/scout-for-lol/packages/data \
  packages/scout-for-lol/packages/report \
  packages/llm-models \
  packages/llm-observability \
  ./
# Bake the Prisma engines into the production tree. prod-deps installs
# without lifecycle scripts, so @prisma/engines ships empty and the CLI
# downloads engines on FIRST USE — but the pod (and the non-root smoke) runs
# as uid 1000 over this root-owned node_modules, so the startup
# `prisma migrate deploy` died with "Can't write to …@prisma+engines…".
# Running generate here (as root, schema present from the source COPY above)
# fetches them at build time; uid 1000 then only reads them at runtime.
# Mirrors the discord-plays-mario-kart runtime fix (2.0.0-6322 crash-loop).
RUN cd packages/scout-for-lol/packages/backend && bunx --trust prisma generate
# Built artifacts from the build stage.
COPY --from=build /app/packages/llm-models/dist packages/llm-models/dist
COPY --from=build /app/packages/scout-for-lol/packages/backend/generated packages/scout-for-lol/packages/backend/generated

ENV NODE_ENV=production

# scout reads VERSION/GIT_SHA at boot (src/configuration.ts requires VERSION).
# Declared as build args so CI can bake the real build number + commit SHA
# (`--build-arg VERSION=… --build-arg GIT_SHA=…`); the `dev`/`unknown` defaults
# keep a plain `docker run` bootable.
ARG VERSION=dev
ARG GIT_SHA=unknown
# Contract-source hash (packages/scout-for-lol/scripts/contract-hash.ts),
# served by /api/version so the SPA can detect contract skew.
ARG CONTRACT_HASH=dev
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV CONTRACT_HASH=${CONTRACT_HASH}

# scout serves an HTTP health/metrics server on PORT (default 3000).
EXPOSE 3000

WORKDIR /app/packages/scout-for-lol/packages/backend

# Run from source (the backend build bundles with `--external '@duckdb/*'`,
# but the old CI image ran source directly). Apply pending migrations before
# start. `prisma` is a runtime dependency of the backend, so `bunx` resolves
# it from the installed tree without a network fetch.
CMD ["/bin/sh", "-c", "bunx prisma migrate deploy && bun run src/index.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=scout-for-lol
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
