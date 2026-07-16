# syntax=docker/dockerfile:1.7-labs
# scout-for-lol backend image. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in this package (which passes `-f Dockerfile ../../../..`).
FROM oven/bun:1.3.14 AS base
WORKDIR /app

# Manifests-only install layer: this ~6 GB `bun install` layer only invalidates
# when a manifest/lockfile/patch changes, not on every source edit.
# `--frozen-lockfile` requires every workspace member's package.json present, so
# the globs enumerate all 47 members (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile

# Now the sources. node_modules is excluded from context by .dockerignore, so
# this does not clobber the installed tree.
COPY . .

# Build @shepherdjerred/llm-models: its package `main`/`types` resolve to a
# gitignored `dist/`, so any consumer (scout's data package imports it) crashes
# at startup with `Cannot find module '@shepherdjerred/llm-models'` unless the
# catalog is compiled first. Mirrors the removed Dagger `withBuiltLlmModels`.
RUN cd packages/llm-models && bun run build

# Generate the Prisma client for the backend (output is gitignored, so it must
# be produced in-image). Engines download at build time — that's expected.
# Only `prisma generate` here — the package's full `generate` script also runs
# brand-types + prettier + a test-template DB build, which are dev/test-only.
RUN cd packages/scout-for-lol/packages/backend && bunx --trust prisma generate

ENV NODE_ENV=production

# scout reads VERSION/GIT_SHA at boot (src/configuration.ts requires VERSION).
# Declared as build args so CI can bake the real build number + commit SHA
# (`--build-arg VERSION=… --build-arg GIT_SHA=…`); the `dev`/`unknown` defaults
# keep a plain `docker run` bootable.
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}

# scout serves an HTTP health/metrics server on PORT (default 3000).
EXPOSE 3000

WORKDIR /app/packages/scout-for-lol/packages/backend

# Run from source (the backend build bundles with `--external '@duckdb/*'`,
# but the old CI image ran source directly). Apply pending migrations before
# start — matches the removed Dagger `buildScoutImageHelper` entrypoint.
CMD ["/bin/sh", "-c", "bunx prisma migrate deploy && bun run src/index.ts"]
