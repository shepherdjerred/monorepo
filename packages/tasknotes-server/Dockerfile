# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
# tasknotes-server image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
#
# Multi-stage: prod-deps installs the production-only dependency closure from
# the workspace manifests; runtime COPYs that tree plus the package's scoped
# source closure and never runs `bun install`. Dev dependencies and the rest of
# the monorepo source never reach the final image, and the source layer only
# invalidates when a closure package changes — not on every repo commit.
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS base
WORKDIR /app

# ── manifests: only the install closure's workspace manifests ───────────────
# Every manifest reaches this cheap stage; installs copy only its output, so an
# edit to a package outside the closure keeps their cache keys and layers.
FROM base AS manifests
COPY --parents \
  package.json scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  /workspace/
COPY --parents \
  ci/scripts/images/workspace-manifests.ts \
  ci/scripts/selectors/select-image-targets-workspaces.ts \
  ci/scripts/selectors/select-image-targets-lockfile.ts \
  /tools/
RUN bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure \
  'tasknotes-server' '@shepherdjerred/tasknotes-web'

# ── prod-deps: production-only node_modules, cached on manifests ────────────
# Copying just the closure's package.json files (plus the lockfile, bunfig, and
# patches) means this filtered install only invalidates when a closure
# manifest/lockfile/patch changes — not on every source edit. The
# tasknotes-server filter includes @shepherdjerred/bugsink-config through its
# workspace dependency closure. The root .dockerignore keeps
# node_modules/dist/.git out of context.
FROM base AS prod-deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter 'tasknotes-server'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

# ── web: Vite build of the browser client, copied into the runtime image ───
# Same projected closure as the server install. This stage keeps dev
# dependencies so Vite can build; the runtime image does not copy them.
FROM base AS web-deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/tasknotes-web'

FROM web-deps AS web-build
COPY --parents \
  tsconfig.base.json \
  packages/tasknotes-web \
  packages/facet-protocol \
  ./
RUN cd packages/tasknotes-web && bun run build

# ── runtime: COPY-only — no install, no build tooling, no network ───────────
FROM base AS runtime
# The isolated-linker tree uses relative symlinks (store at node_modules/.bun),
# so copying the whole install root between same-rooted stages is safe. Kept
# BEFORE the source COPY so a source edit doesn't re-push this layer.
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
# Scoped source closure: this package, its workspace deps, and the root
# tsconfig.
COPY --parents \
  tsconfig.base.json \
  packages/tasknotes-server \
  packages/bugsink-config \
  ./

COPY --from=web-build /app/packages/tasknotes-web/dist packages/tasknotes-web/dist

# Prisma's CLI records per-run state under $HOME; keep it out of the layer.
RUN cd packages/tasknotes-server && CHECKPOINT_DISABLE=1 bunx --no-install --trust prisma generate \
  && rm -rf "$HOME/.cache/checkpoint-nodejs" "$HOME/.config/prisma-nodejs"

ENV NODE_ENV=production
# The Prisma CLI runs at container start (migrations); keep its update-check
# telemetry (checkpoint.prisma.io) off so it never attempts denied egress.
ENV CHECKPOINT_DISABLE=1
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# tasknotes-server serves on PORT (default 3000) with no external auth at boot.
EXPOSE 3000

CMD ["bun", "packages/tasknotes-server/src/index.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes ci/, so stage it here (never in the pushed image stage).
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
ARG SMOKE_TARGET=tasknotes-server
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
