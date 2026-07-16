# syntax=docker/dockerfile:1.7-labs
# tasknotes-server image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
FROM oven/bun:1.3.14 AS base
WORKDIR /app

# Manifests-only install layer. Copying just the workspace package.json files
# (plus the lockfile, bunfig, and patches) BEFORE the source means this ~6 GB
# `bun install` layer only invalidates when a manifest/lockfile/patch changes —
# not on every source edit. `--frozen-lockfile` requires every workspace
# member's package.json present, so the globs below enumerate all 47 members
# (top-level, nested `packages/*/packages/*`, homelab/src/*, the desktop
# src-tauri crate, and the `scripts` dir). The root .dockerignore keeps
# node_modules/dist/.git out of context.
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

ENV NODE_ENV=production

# tasknotes-server serves on PORT (default 3000) with no external auth at boot.
EXPOSE 3000

CMD ["bun", "packages/tasknotes-server/src/index.ts"]
