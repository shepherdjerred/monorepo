# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# birmel image. Build context is the REPO ROOT (single Bun workspace, one root
# bun.lock, isolated linker). Built via `bun run docker:build` in this package
# (which passes `-f Dockerfile ../..`).
#
# birmel's editor sub-agent shells out to `gh` (opens PRs) and `claude` (runs
# edits); its music stack shells out through youtube-dl-exec (needs Node + Python
# + a yt-dlp binary) and ffmpeg-static.
#
# Multi-stage: deps does a full (dev-inclusive) install to feed the in-image
# prisma generate; prod-deps installs the production-only closure; runtime
# COPYs the prod tree, the scoped source closure, and the generated Prisma
# client — it never runs `bun install`. Dev dependencies and the rest of the
# monorepo source never reach the final image, and the source layer only
# invalidates when a closure package changes — not on every repo commit.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# ── deps: full install (dev deps) — feeds the prisma generate below ─────────
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
RUN bun install --frozen-lockfile --filter '@shepherdjerred/birmel'

# ── build: generate the Prisma client (output is gitignored, produced here) ──
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/birmel \
  packages/glitter-context \
  ./
RUN cd packages/glitter-context && bun run build
RUN cd packages/birmel && bun run generate

# ── prod-deps: production-only node_modules, cached on manifests ────────────
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/birmel'

# ── runtime: CLIs + COPY-only app layers — no install, no build tooling ─────
FROM base AS runtime

# --- gh CLI + Claude Code CLI (editor sub-agent) ---
# BUN_INSTALL=/usr/local drops `bun add -g` binaries into /usr/local/bin
# (world-readable, on PATH). gh is fetched from the release tarball.
# renovate: datasource=github-releases depName=cli/cli
ARG GH_CLI_VERSION=2.96.0
# renovate: datasource=npm depName=@anthropic-ai/claude-code
ARG CLAUDE_CODE_VERSION=2.1.175
ENV BUN_INSTALL=/usr/local
RUN set -e; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends ca-certificates curl git; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" = "amd64" ]; then gharch=amd64; \
    elif [ "$arch" = "arm64" ]; then gharch=arm64; \
    else echo "unsupported architecture: $arch" >&2; exit 1; fi; \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_${gharch}.tar.gz" \
      | tar xz -C /usr/local/bin --strip-components=2 "gh_${GH_CLI_VERSION}_linux_${gharch}/bin/gh"; \
    rm -rf /var/lib/apt/lists/*
RUN bun add -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && claude --version

# --- Music runtime: Node + Python for youtube-dl-exec / yt-dlp ---
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

# youtube-dl-exec resolves its binary at node_modules/youtube-dl-exec/bin/yt-dlp,
# but its own postinstall fetches that UNAUTHENTICATED from api.github.com and
# flakes on shared runners. Provide it via the rate-limit-proof, SHA-verified
# release-CDN download instead. Sequenced AFTER the prod-deps COPY (the target
# dir must exist) and BEFORE the source COPY (a source edit must not re-trigger
# this network fetch).
# renovate: datasource=github-releases depName=yt-dlp/yt-dlp
ARG YT_DLP_VERSION=2026.07.04
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" = "amd64" ]; then asset=yt-dlp_linux; \
    elif [ "$arch" = "arm64" ]; then asset=yt-dlp_linux_aarch64; \
    else echo "unsupported architecture: $arch" >&2; exit 1; fi; \
    base="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}"; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/$asset" -o "/tmp/$asset"; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/SHA2-256SUMS" -o /tmp/SHA2-256SUMS; \
    (cd /tmp && sha256sum -c --ignore-missing SHA2-256SUMS); \
    install -D -m 0755 "/tmp/$asset" /app/packages/birmel/node_modules/youtube-dl-exec/bin/yt-dlp; \
    rm -f "/tmp/$asset" /tmp/SHA2-256SUMS; \
    test -x /app/packages/birmel/node_modules/youtube-dl-exec/bin/yt-dlp

# Scoped source closure + the generated Prisma client from the build stage.
COPY --parents \
  tsconfig.base.json \
  packages/birmel \
  packages/llm-observability \
  ./
COPY --from=build /app/packages/birmel/generated packages/birmel/generated
COPY --from=build /app/packages/glitter-context/dist packages/glitter-context/dist

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Run from the package dir so Bun resolves this package's tsconfig / imports map
# (the `#generated/*` subpath imports). The old prod entrypoint also ran
# `prisma db push` before boot; that's a runtime DB step for the deployed
# service and is left to the deployment (not baked into the image CMD).
WORKDIR /app/packages/birmel
CMD ["bun", "src/index.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
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
