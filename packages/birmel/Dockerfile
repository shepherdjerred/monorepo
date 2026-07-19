# syntax=docker/dockerfile:1.7-labs
# birmel image. Build context is the REPO ROOT (single Bun workspace, one root
# bun.lock, isolated linker). Built via `bun run docker:build` in this package
# (which passes `-f Dockerfile ../..`).
#
# birmel's editor sub-agent shells out to `gh` (opens PRs) and `claude` (runs
# edits); its music stack shells out through youtube-dl-exec (needs Node + Python
# + a yt-dlp binary) and ffmpeg-static. This mirrors the old Dagger
# withEditorClis + withBirmelMusicRuntime + installYtDlp path.
FROM oven/bun:1.3.14 AS base
WORKDIR /app

# --- gh CLI + Claude Code CLI (editor sub-agent) ---
# BUN_INSTALL=/usr/local drops `bun add -g` binaries into /usr/local/bin
# (world-readable, on PATH). gh is fetched from the release tarball.
ARG GH_CLI_VERSION=2.96.0
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

# --- Workspace install + prisma generate ---
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

# youtube-dl-exec resolves its binary at node_modules/youtube-dl-exec/bin/yt-dlp,
# but its own postinstall fetches that UNAUTHENTICATED from api.github.com and
# flakes on shared runners. Provide it via the rate-limit-proof, SHA-verified
# release-CDN download instead (mirrors the old installYtDlp for birmel).
# Kept BEFORE the source COPY: the target dir exists right after the
# install layer, and a source edit must not re-trigger this network fetch.
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" = "amd64" ]; then asset=yt-dlp_linux; \
    elif [ "$arch" = "arm64" ]; then asset=yt-dlp_linux_aarch64; \
    else echo "unsupported architecture: $arch" >&2; exit 1; fi; \
    base=https://github.com/yt-dlp/yt-dlp/releases/latest/download; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/$asset" -o "/tmp/$asset"; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/SHA2-256SUMS" -o /tmp/SHA2-256SUMS; \
    cd /tmp; \
    grep " $asset$" SHA2-256SUMS > "$asset.sha256"; \
    sha256sum -c "$asset.sha256"; \
    install -D -m 0755 "/tmp/$asset" /app/packages/birmel/node_modules/youtube-dl-exec/bin/yt-dlp; \
    rm -f "/tmp/$asset" /tmp/SHA2-256SUMS "/tmp/$asset.sha256"; \
    test -x /app/packages/birmel/node_modules/youtube-dl-exec/bin/yt-dlp

# Now the sources. node_modules is excluded from context by .dockerignore, so
# this does not clobber the installed tree.
COPY . .

# birmel's Prisma client is generated into the package (its `generate` script
# runs `bunx --trust prisma generate`). Run it in-image so the client exists at
# boot. Mirrors the old usePrisma entrypoint's generate step.
RUN cd packages/birmel && bun run generate

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
