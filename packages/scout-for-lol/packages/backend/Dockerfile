# scout-for-lol backend image. Build context is the REPO ROOT (single Bun
# workspace, one root bun.lock, isolated linker, workspace:* deps). Built via
# `bun run docker:build` in this package (which passes `-f Dockerfile ../../../..`).
FROM oven/bun:1.3.14 AS base
WORKDIR /app

# Copy the whole workspace and install once at the root against the single
# lockfile. The root .dockerignore keeps node_modules/dist/.git out of context.
COPY . .
RUN bun install --frozen-lockfile

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
# The old Dagger image baked these via withEnvVariable; the deploy pipeline
# overrides them per release. Defaults keep a plain `docker run` bootable.
ENV VERSION=dev
ENV GIT_SHA=unknown

# scout serves an HTTP health/metrics server on PORT (default 3000).
EXPOSE 3000

WORKDIR /app/packages/scout-for-lol/packages/backend

# Run from source (the backend build bundles with `--external '@duckdb/*'`,
# but the old CI image ran source directly). Apply pending migrations before
# start — matches the removed Dagger `buildScoutImageHelper` entrypoint.
CMD ["/bin/sh", "-c", "bunx prisma migrate deploy && bun run src/index.ts"]
