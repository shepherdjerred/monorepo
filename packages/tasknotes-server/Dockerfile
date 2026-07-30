# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# tasknotes-server image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
#
# Multi-stage: prod-deps installs the production-only dependency closure from
# the workspace manifests; runtime COPYs that tree plus the package's scoped
# source closure and never runs `bun install`. Dev dependencies and the rest of
# the monorepo source never reach the final image, and the source layer only
# invalidates when a closure package changes — not on every repo commit.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# ── prod-deps: production-only node_modules, cached on manifests ────────────
# Copying just the workspace package.json files (plus the lockfile, bunfig, and
# patches) means this filtered install only invalidates when a
# manifest/lockfile/patch changes — not on every source edit. The
# tasknotes-server filter includes tasknotes-types through its workspace
# dependency closure. `--frozen-lockfile` requires every workspace member's
# package.json present, so the globs below enumerate every member (top-level,
# nested `packages/*/packages/*`, homelab/src/*, the desktop src-tauri crate,
# and the `scripts` dir). The root .dockerignore keeps node_modules/dist/.git
# out of context.
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter 'tasknotes-server'

# ── runtime: COPY-only — no install, no build tooling, no network ───────────
FROM base AS runtime
# The isolated-linker tree uses relative symlinks (store at node_modules/.bun),
# so copying the whole install root between same-rooted stages is safe. Kept
# BEFORE the source COPY so a source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/
# Scoped source closure: this package, its workspace dep, and the root
# tsconfig the package tsconfig extends.
COPY --parents \
  tsconfig.base.json \
  packages/tasknotes-server \
  packages/tasknotes-types \
  ./

ENV NODE_ENV=production

# tasknotes-server serves on PORT (default 3000) with no external auth at boot.
EXPOSE 3000

CMD ["bun", "packages/tasknotes-server/src/index.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=tasknotes-server
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
