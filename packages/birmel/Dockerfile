# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
# birmel image. Build context is the REPO ROOT (single Bun workspace, one root
# bun.lock, isolated linker). Built via `bun run docker:build` in this package
# (which passes `-f Dockerfile ../..`).
#
# Multi-stage: deps does a full (dev-inclusive) install to feed the in-image
# prisma generate; prod-deps installs the production-only closure; runtime
# COPYs the prod tree, the scoped source closure, and the generated Prisma
# client — it never runs `bun install`. Dev dependencies and the rest of the
# monorepo source never reach the final image, and the source layer only
# invalidates when a closure package changes — not on every repo commit.
FROM oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS base
WORKDIR /app

# ── deps: full install (dev deps) — feeds the prisma generate below ─────────
# `--frozen-lockfile` requires every workspace member's package.json present,
# so the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
FROM base AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/birmel'

# ── build: generate the Prisma client (output is gitignored, produced here) ──
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/birmel \
  packages/config \
  packages/feature-flags \
  packages/glitter-context \
  packages/llm-models \
  ./
RUN cd packages/glitter-context && bun run build
# llm-models' package `main`/`exports` resolve to a gitignored `dist/`, so the
# llm-runtime closure Birmel imports at startup crashes with `Cannot find
# module '@shepherdjerred/llm-models'` unless the catalog is compiled first.
RUN cd packages/llm-models && bun run build
RUN cd packages/birmel && bun run generate

# ── prod-deps: production-only node_modules, cached on manifests ────────────
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/birmel'

# ── runtime: shell-tool runtimes + COPY-only app layers — no build tooling ──
FROM base AS runtime

# --- Runtimes advertised by the shell tool ---
# `execute-shell-command` documents `python3` and `node` with worked examples
# (src/agent-tools/tools/automation/shell.ts), so the image must actually carry
# them. Bun ships a `node` shim at /usr/local/bun-node-fallback-bin/node that is
# not a usable Node, so real Node is installed rather than relied upon.
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Acknowledged per-site so a NEW unpinned install
# still fails.
# hadolint ignore=DL3008
RUN set -e; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends nodejs python3; \
    rm -rf /var/lib/apt/lists/*; \
    node --version; python3 --version

# Production node_modules + workspace manifests. The isolated-linker tree uses
# relative symlinks (store at node_modules/.bun), so copying the whole install
# root between same-rooted stages is safe. Kept BEFORE the source COPY so a
# source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/

# Scoped source closure + the generated Prisma client from the build stage.
COPY --parents \
  tsconfig.base.json \
  packages/birmel \
  packages/config \
  packages/feature-flags \
  packages/llm-models \
  packages/llm-observability \
  packages/s3-signed-request \
  packages/llm-runtime \
  ./
# Bake Prisma's migration engines into the production dependency tree. Bun's
# production install omits lifecycle scripts, so the CLI otherwise downloads
# engines on first use. Runtime and smoke execute as uid 1000 over root-owned
# node_modules, which correctly prevents that startup write. Generate once as
# root during the image build so migrate deploy is read-only at runtime.
RUN cd packages/birmel && bunx --trust prisma generate
COPY --from=build /app/packages/birmel/generated packages/birmel/generated
COPY --from=build /app/packages/glitter-context/dist packages/glitter-context/dist
COPY --from=build /app/packages/llm-models/dist packages/llm-models/dist

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
ENV BIRMEL_SCREENSHOTS_DIR=/app/data/screenshots
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Run from the package dir so Bun resolves this package's tsconfig / imports map
# (the `#generated/*` subpath imports). The entrypoint fingerprints an existing
# unmigrated database, resolves the verified baseline, and runs migrate deploy
# before starting Discord.
WORKDIR /app/packages/birmel
RUN mkdir -p /app/data/screenshots && chown -R 1000:1000 /app/data
USER 1000:1000
CMD ["bun", "scripts/start.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
COPY .buildkite/scripts/smoke-app-configs.ts /app/.buildkite/scripts/smoke-app-configs.ts
ARG SMOKE_TARGET=birmel
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
