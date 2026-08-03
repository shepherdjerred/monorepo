# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# scout-evals image. Build context is the REPO ROOT (single Bun workspace, one
# root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../../../..`).
#
# Multi-stage: prod-deps installs the production-only dependency closure from
# the workspace manifests; build installs dev deps and runs `vite build` for
# the client bundle; runtime COPYs the prod tree, this package's source, and
# the built client — it never runs `bun install`. The @scout-for-lol/data
# package (82 MB of splash assets) is deliberately NOT copied: only the
# local-only materialization/discovery scripts import it, never the server or
# client, so its dangling workspace symlink is never resolved at runtime.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# ── prod-deps: production-only node_modules, cached on manifests ────────────
# Copying just the workspace package.json files (plus the lockfile, bunfig, and
# patches) means this filtered install only invalidates when a
# manifest/lockfile/patch changes — not on every source edit. `--frozen-lockfile`
# requires every workspace member's package.json present, so the globs below
# enumerate every member. The root .dockerignore keeps node_modules/dist/.git
# and this package's local data/ SQLite out of context.
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@scout-for-lol/evals'

# ── build: dev deps + vite build for the client bundle ──────────────────────
FROM base AS build
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@scout-for-lol/evals'
# The evals tsconfig extends scout's own tsconfig.base.json (not the root one).
COPY --parents \
  packages/scout-for-lol/tsconfig.base.json \
  packages/scout-for-lol/packages/evals \
  ./
RUN cd packages/scout-for-lol/packages/evals && bun run build

# ── runtime: COPY-only — no install, no build tooling, no network ───────────
FROM base AS runtime
# The isolated-linker tree uses relative symlinks (store at node_modules/.bun),
# so copying the whole install root between same-rooted stages is safe. Kept
# BEFORE the source COPY so a source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/
COPY --parents \
  packages/scout-for-lol/tsconfig.base.json \
  packages/scout-for-lol/packages/evals \
  ./
COPY --from=build \
  /app/packages/scout-for-lol/packages/evals/dist/client \
  /app/packages/scout-for-lol/packages/evals/dist/client

ENV NODE_ENV=production

# app.ts serves ./dist/client cwd-relative, so the workdir must be the package.
WORKDIR /app/packages/scout-for-lol/packages/evals

# No auth by design: the deployment fronts this with a tailnet-only Tailscale
# ingress. SCOUT_EVAL_HOSTNAME / SCOUT_EVAL_DATABASE_PATH configure the bind
# and the PVC-backed SQLite path; both default to local-dev values.
EXPOSE 7341

CMD ["bun", "src/server/index.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
ARG SMOKE_TARGET=scout-evals
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000), never root: it must prove the
# server can create its WAL-mode SQLite (and sidecar files) as uid 1000, the
# same uid the K8s deployment runs with. HOME points at /tmp for tool caches.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
